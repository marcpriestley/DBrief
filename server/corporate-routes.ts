import type { Express } from "express";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { organisations } from "@shared/schema";
import crypto from "crypto";

const CORPORATE_ENABLED = process.env.CORPORATE_TIER_ENABLED === "true";

function getUserId(req: any): number {
  const id = (req.session as any)?.userId;
  if (!id) throw Object.assign(new Error("Not authenticated"), { status: 401 });
  return id;
}

function requireCorporate(_req: any, res: any, next: any) {
  if (!CORPORATE_ENABLED) return res.status(404).json({ message: "Not found" });
  next();
}

async function requireOrgAdmin(req: any, res: any, next: any) {
  if (!CORPORATE_ENABLED) return res.status(404).json({ message: "Not found" });
  try {
    const userId = getUserId(req);
    const org = await storage.getOrganisationByAdmin(userId);
    if (!org) return res.status(403).json({ message: "Not an organisation admin" });
    req.org = org;
    req.adminUserId = userId;
    next();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message });
  }
}

// ── Corporate Stripe price singleton ─────────────────────────────────────────
let _corporatePriceIdPromise: Promise<string> | null = null;

async function getCorporatePriceId(): Promise<string> {
  if (_corporatePriceIdPromise) return _corporatePriceIdPromise;
  _corporatePriceIdPromise = (async () => {
    const stripe = await getUncachableStripeClient();

    // Look for existing DBrief Corporate product
    const products = await stripe.products.list({ limit: 100 });
    let product = products.data.find(p => p.name === "DBrief Corporate" && p.active);
    if (!product) {
      product = await stripe.products.create({
        name: "DBrief Corporate",
        description: "DBrief Corporate seat plan — per-seat monthly subscription",
      });
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 10 });
    const existing = prices.data.find(p => p.active && p.recurring?.interval === "month");
    if (existing) return existing.id;

    const price = await stripe.prices.create({
      product: product.id,
      currency: "gbp",
      unit_amount: 399,
      recurring: { interval: "month" },
      billing_scheme: "per_unit",
    });
    return price.id;
  })();
  return _corporatePriceIdPromise;
}

export function registerCorporateRoutes(app: Express) {
  if (!CORPORATE_ENABLED) return;

  // ── GET /api/corporate/membership ─────────────────────────────────────────
  // Returns this user's org membership + org settings (for all org members).
  // Called by OrgBrandingContext on startup.
  app.get("/api/corporate/membership", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      const membership = await storage.getOrgMembershipByUser(userId);
      if (!membership) {
        // Also check if this user is an admin
        const adminOrg = await storage.getOrganisationByAdmin(userId);
        if (!adminOrg) return res.json(null);
        return res.json({
          role: "admin",
          orgId: adminOrg.id,
          orgName: adminOrg.name,
          accentColour: adminOrg.accentColour,
          aiPersonaName: adminOrg.aiPersonaName,
          logoUrl: adminOrg.logoUrl,
          subscriptionStatus: adminOrg.subscriptionStatus,
        });
      }
      return res.json({
        role: "member",
        orgId: membership.organisation.id,
        orgName: membership.organisation.name,
        accentColour: membership.organisation.accentColour,
        aiPersonaName: membership.organisation.aiPersonaName,
        logoUrl: membership.organisation.logoUrl,
        subscriptionStatus: membership.organisation.subscriptionStatus,
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── POST /api/corporate/org ───────────────────────────────────────────────
  // Create a new organisation for this user (they become the admin).
  app.post("/api/corporate/org", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      // One org per admin
      const existing = await storage.getOrganisationByAdmin(userId);
      if (existing) return res.status(409).json({ message: "You already have an organisation" });

      const { name, seatCount = 5 } = req.body;
      if (!name) return res.status(400).json({ message: "name is required" });

      const org = await storage.createOrganisation({
        name,
        seatCount: Math.max(1, Number(seatCount)),
        adminUserId: userId,
        subscriptionStatus: "inactive",
      });
      res.status(201).json(org);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── GET /api/corporate/org ────────────────────────────────────────────────
  // Get the org for the current admin.
  app.get("/api/corporate/org", requireOrgAdmin, async (req: any, res) => {
    res.json(req.org);
  });

  // ── PUT /api/corporate/org/settings ──────────────────────────────────────
  // Update org branding / name / persona.
  app.put("/api/corporate/org/settings", requireOrgAdmin, async (req: any, res) => {
    try {
      const { name, logoUrl, accentColour, aiPersonaName, seatCount } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (logoUrl !== undefined) updates.logoUrl = logoUrl;
      if (accentColour !== undefined) updates.accentColour = accentColour;
      if (aiPersonaName !== undefined) updates.aiPersonaName = aiPersonaName;
      if (seatCount !== undefined) updates.seatCount = Math.max(1, Number(seatCount));

      const org = await storage.updateOrganisation(req.org.id, updates);
      res.json(org);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── GET /api/corporate/dashboard ─────────────────────────────────────────
  // Full dashboard data: members list + team engagement stats.
  app.get("/api/corporate/dashboard", requireOrgAdmin, async (req: any, res) => {
    try {
      const [members, stats, challengeIds] = await Promise.all([
        storage.getOrgMembersByOrg(req.org.id),
        storage.getOrgTeamStats(req.org.id),
        storage.getOrgChallengeIds(req.org.id),
      ]);
      res.json({
        org: req.org,
        members,
        stats,
        challengeCount: challengeIds.length,
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── POST /api/corporate/invite ────────────────────────────────────────────
  // Invite a member by email. Returns the invite URL for the admin to share.
  app.post("/api/corporate/invite", requireOrgAdmin, async (req: any, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.includes("@")) return res.status(400).json({ message: "Valid email required" });

      const normalised = email.toLowerCase().trim();
      const org: any = req.org;

      // Check seat limit
      const existingMembers = await storage.getOrgMembersByOrg(org.id);
      const activeCount = existingMembers.filter(m => m.status === "active").length;
      if (activeCount >= (org.seatCount ?? 5)) {
        return res.status(400).json({ message: `Seat limit (${org.seatCount}) reached. Upgrade your plan to add more seats.` });
      }

      // Already invited?
      const existing = await storage.getOrgMemberByEmail(org.id, normalised);
      if (existing) return res.status(409).json({ message: "This email has already been invited" });

      const token = crypto.randomBytes(32).toString("hex");
      await storage.createOrgMember({
        orgId: org.id,
        email: normalised,
        status: "pending",
        inviteToken: token,
        userId: null,
      });

      const baseUrl = process.env.REPLIT_DEPLOYMENT === "1"
        ? `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`
        : "http://localhost:5000";

      res.json({
        message: "Invite created",
        email: normalised,
        inviteUrl: `${baseUrl}/join/${token}`,
        note: "Copy this link and email it to the invitee. A built-in email delivery option is coming soon.",
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── POST /api/corporate/join/:token ──────────────────────────────────────
  // Accept an invite. The user must be logged in.
  app.post("/api/corporate/join/:token", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { token } = req.params;

      const member = await storage.getOrgMemberByToken(token);
      if (!member) return res.status(404).json({ message: "Invite not found or already used" });
      if (member.status === "active") return res.status(400).json({ message: "This invite has already been used" });

      // Check the org is active
      const org = await storage.getOrganisationById(member.orgId);
      if (!org) return res.status(404).json({ message: "Organisation not found" });

      // Check seat limit
      const existingMembers = await storage.getOrgMembersByOrg(org.id);
      const activeCount = existingMembers.filter(m => m.status === "active").length;
      if (activeCount >= (org.seatCount ?? 5)) {
        return res.status(400).json({ message: "This organisation has reached its seat limit" });
      }

      // Make sure no other active membership
      const existingMembership = await storage.getOrgMembershipByUser(userId);
      if (existingMembership) {
        return res.status(409).json({ message: "You are already a member of an organisation" });
      }

      await storage.updateOrgMember(member.id, {
        userId,
        status: "active",
        joinedAt: new Date(),
        inviteToken: null,
      } as any);

      res.json({ message: "Successfully joined organisation", orgName: org.name });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── GET /api/corporate/join/:token ────────────────────────────────────────
  // Preview invite details (org name, etc.) without consuming the token.
  app.get("/api/corporate/join/:token", requireCorporate, async (req, res) => {
    try {
      const { token } = req.params;
      const member = await storage.getOrgMemberByToken(token);
      if (!member || member.status !== "pending") {
        return res.status(404).json({ message: "Invite not found or already used" });
      }
      const org = await storage.getOrganisationById(member.orgId);
      if (!org) return res.status(404).json({ message: "Organisation not found" });
      res.json({
        orgName: org.name,
        email: member.email,
        accentColour: org.accentColour,
        logoUrl: org.logoUrl,
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── POST /api/corporate/checkout ─────────────────────────────────────────
  // Create a Stripe Checkout session for the org plan.
  app.post("/api/corporate/checkout", requireOrgAdmin, async (req: any, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      const priceId = await getCorporatePriceId();
      const org: any = req.org;
      const userId: number = req.adminUserId;

      // Ensure Stripe customer for the admin user
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.username,
          name: org.name,
          metadata: { orgId: String(org.id), userId: String(userId) },
        });
        customerId = customer.id;
        await storage.updateOrganisation(org.id, { stripeCustomerId: customerId });
      }

      const baseUrl = process.env.REPLIT_DEPLOYMENT === "1"
        ? `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`
        : "http://localhost:5000";

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{
          price: priceId,
          quantity: org.seatCount ?? 5,
        }],
        success_url: `${baseUrl}/corporate/dashboard?setup=success`,
        cancel_url: `${baseUrl}/corporate/onboarding?step=checkout&cancelled=1`,
        metadata: { orgId: String(org.id) },
        subscription_data: {
          metadata: { orgId: String(org.id) },
        },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[Corporate Checkout]", err.message);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // ── POST /api/corporate/portal ────────────────────────────────────────────
  // Create a Stripe billing portal session for the org admin.
  app.post("/api/corporate/portal", requireOrgAdmin, async (req: any, res) => {
    try {
      const org: any = req.org;
      if (!org.stripeCustomerId) {
        return res.status(400).json({ message: "No billing account found. Please complete checkout first." });
      }
      const stripe = await getUncachableStripeClient();
      const baseUrl = process.env.REPLIT_DEPLOYMENT === "1"
        ? `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`
        : "http://localhost:5000";

      const session = await stripe.billingPortal.sessions.create({
        customer: org.stripeCustomerId,
        return_url: `${baseUrl}/corporate/dashboard`,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to create portal session" });
    }
  });

  // ── POST /api/corporate/org-challenge ────────────────────────────────────
  // Create a challenge scoped to the org (all members auto-added).
  app.post("/api/corporate/org-challenge", requireOrgAdmin, async (req: any, res) => {
    try {
      const org: any = req.org;
      const { title, description, type, habitName, habitEmoji, metricName, startDate, endDate, frequency } = req.body;
      if (!title || !type || !startDate || !endDate) {
        return res.status(400).json({ message: "title, type, startDate, endDate required" });
      }

      const { insertChallengeSchema } = await import("@shared/schema");
      const parsed = insertChallengeSchema.safeParse({
        creatorId: req.adminUserId,
        title, description, type, habitName, habitEmoji, metricName,
        visibility: "org",
        frequency: frequency ?? "daily",
        startDate, endDate,
      });
      if (!parsed.success) return res.status(400).json({ message: "Invalid challenge data" });

      const challenge = await storage.createChallenge(req.adminUserId, parsed.data);
      await storage.addOrgChallenge(org.id, challenge.id);

      // Auto-add all active org members as participants
      const members = await storage.getOrgMembersByOrg(org.id);
      const activeUserIds = members
        .filter(m => m.status === "active" && m.userId !== null && m.userId !== req.adminUserId)
        .map(m => m.userId as number);

      for (const uid of activeUserIds) {
        try {
          await storage.joinChallenge(challenge.id, uid);
        } catch {}
      }

      res.status(201).json(challenge);
    } catch (err: any) {
      console.error("[OrgChallenge]", err.message);
      res.status(500).json({ message: "Failed to create org challenge" });
    }
  });

  // ── DELETE /api/corporate/members/:id ───────────────────────────────────
  // Remove a member from the org.
  app.delete("/api/corporate/members/:id", requireOrgAdmin, async (req: any, res) => {
    try {
      const memberId = Number(req.params.id);
      const members = await storage.getOrgMembersByOrg(req.org.id);
      const member = members.find(m => m.id === memberId);
      if (!member) return res.status(404).json({ message: "Member not found" });
      await storage.updateOrgMember(memberId, { status: "removed" } as any);
      res.json({ message: "Member removed" });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });
}

// ── Stripe webhook handler for corporate subscriptions ──────────────────────
export async function handleCorporateWebhookEvent(event: any) {
  if (!CORPORATE_ENABLED) return;
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orgId = session.metadata?.orgId ? Number(session.metadata.orgId) : null;
      if (!orgId) return;
      await db.update(organisations)
        .set({ subscriptionStatus: "active" })
        .where(eq(organisations.id, orgId));
      console.log(`[Corporate] Org ${orgId} activated`);
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const orgId = sub.metadata?.orgId ? Number(sub.metadata.orgId) : null;
      if (!orgId) return;
      const status = sub.status === "active" ? "active" : "inactive";
      await db.update(organisations).set({ subscriptionStatus: status }).where(eq(organisations.id, orgId));
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const orgId = sub.metadata?.orgId ? Number(sub.metadata.orgId) : null;
      if (!orgId) return;
      await db.update(organisations).set({ subscriptionStatus: "cancelled" }).where(eq(organisations.id, orgId));
    }
  } catch (err: any) {
    console.error("[Corporate Webhook]", err.message);
  }
}
