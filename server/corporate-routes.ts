import type { Express } from "express";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { organisations } from "@shared/schema";
import crypto from "crypto";
import nodemailer from "nodemailer";
import type { InsertOrganisation, Organisation } from "@shared/schema";

const CORPORATE_ENABLED = process.env.CORPORATE_TIER_ENABLED === "true";

// ── Email helper ─────────────────────────────────────────────────────────────
// Sends the invite email. Falls back to console logging when SMTP is not
// configured so the flow still works during development.
async function sendInviteEmail(opts: { to: string; orgName: string; inviteUrl: string }): Promise<void> {
  const { to, orgName, inviteUrl } = opts;

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser ?? "noreply@dbrief.app";
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.log(`[Corporate Invite] SMTP not configured — invite URL for ${to}: ${inviteUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #141414; color: #f5f5f5; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 28px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: #d97706; color: #141414; font-size: 24px; font-weight: 900; line-height: 48px; text-align: center;">D</div>
        <h1 style="color: #f5f5f5; font-size: 22px; margin: 16px 0 4px;">DBrief App — Team Invite</h1>
        <p style="color: #999; font-size: 14px; margin: 0;">${orgName} has invited you to join their team</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background: #d97706; color: #141414; font-weight: 700; border-radius: 12px; text-decoration: none; font-size: 15px;">Join ${orgName} →</a>
      </div>
      <p style="color: #666; font-size: 12px; text-align: center; margin-top: 24px; line-height: 1.5;">
        Your performance data stays private — no manager can read your debriefs or journal.
        <br>This link is single-use. Once you join, it expires.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `DBrief App <${smtpFrom}>`,
    to,
    subject: `You've been invited to join ${orgName} on DBrief App`,
    html,
    text: `${orgName} has invited you to DBrief App. Click here to join: ${inviteUrl}`,
  });

  console.log(`[Corporate Invite] Email sent to ${to}`);
}

// ── Route helpers ─────────────────────────────────────────────────────────────
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
  app.get("/api/corporate/membership", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      const membership = await storage.getOrgMembershipByUser(userId);
      if (!membership) {
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
  app.post("/api/corporate/org", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      const existing = await storage.getOrganisationByAdmin(userId);
      if (existing) return res.status(409).json({ message: "You already have an organisation" });

      const { name, seatCount = 5 } = req.body;
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ message: "name must be at least 2 characters" });
      }

      const org = await storage.createOrganisation({
        name: name.trim(),
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
  app.get("/api/corporate/org", requireOrgAdmin, async (req: any, res) => {
    res.json(req.org);
  });

  // ── PUT /api/corporate/org/settings ──────────────────────────────────────
  // Branding fields only. seatCount is excluded — its authoritative value
  // comes from the Stripe subscription item quantity (synced via webhook).
  app.put("/api/corporate/org/settings", requireOrgAdmin, async (req: any, res) => {
    try {
      const { name, logoUrl, accentColour, aiPersonaName } = req.body;
      const updates: Partial<InsertOrganisation> = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (logoUrl !== undefined) updates.logoUrl = logoUrl || null;
      if (accentColour !== undefined) updates.accentColour = accentColour;
      if (aiPersonaName !== undefined) updates.aiPersonaName = aiPersonaName;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No updatable fields provided" });
      }

      const org = await storage.updateOrganisation(req.org.id, updates);
      res.json(org);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── GET /api/corporate/dashboard ─────────────────────────────────────────
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
  app.post("/api/corporate/invite", requireOrgAdmin, async (req: any, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ message: "Valid email required" });
      }

      const normalised = email.toLowerCase().trim();
      const org: typeof req.org = req.org;

      const existingMembers = await storage.getOrgMembersByOrg(org.id);
      const activeCount = existingMembers.filter((m: any) => m.status === "active").length;
      if (activeCount >= (org.seatCount ?? 5)) {
        return res.status(400).json({ message: `Seat limit (${org.seatCount}) reached. Upgrade your plan to add more seats.` });
      }

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
      const inviteUrl = `${baseUrl}/join/${token}`;

      // Send the invite email (falls back to console log when SMTP is not configured)
      try {
        await sendInviteEmail({ to: normalised, orgName: org.name, inviteUrl });
      } catch (emailErr: any) {
        console.error("[Corporate Invite] Email failed:", emailErr.message);
      }

      res.json({
        message: "Invite sent",
        email: normalised,
        inviteUrl,
        emailDelivered: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── GET /api/corporate/join/:token ────────────────────────────────────────
  // Preview invite without consuming the token.
  app.get("/api/corporate/join/:token", async (req, res) => {
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

  // ── POST /api/corporate/join/:token ──────────────────────────────────────
  // Accept an invite. The user must be logged in and their email must match.
  app.post("/api/corporate/join/:token", requireCorporate, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { token } = req.params;

      const member = await storage.getOrgMemberByToken(token);
      if (!member) return res.status(404).json({ message: "Invite not found or already used" });
      if (member.status === "active") return res.status(400).json({ message: "This invite has already been used" });

      // Security: the logged-in user's email must match the invited email
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      if (user.username.toLowerCase() !== member.email.toLowerCase()) {
        return res.status(403).json({ message: `This invite was sent to ${member.email}. Please log in with that account.` });
      }

      const org = await storage.getOrganisationById(member.orgId);
      if (!org) return res.status(404).json({ message: "Organisation not found" });

      const existingMembers = await storage.getOrgMembersByOrg(org.id);
      const activeCount = existingMembers.filter((m: any) => m.status === "active").length;
      if (activeCount >= (org.seatCount ?? 5)) {
        return res.status(400).json({ message: "This organisation has reached its seat limit" });
      }

      const existingMembership = await storage.getOrgMembershipByUser(userId);
      if (existingMembership) {
        return res.status(409).json({ message: "You are already a member of an organisation" });
      }

      await storage.updateOrgMember(member.id, {
        userId,
        status: "active",
        joinedAt: new Date(),
        inviteToken: null,
      });

      res.json({ message: "Successfully joined organisation", orgName: org.name });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });

  // ── POST /api/corporate/checkout ─────────────────────────────────────────
  app.post("/api/corporate/checkout", requireOrgAdmin, async (req: any, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      const priceId = await getCorporatePriceId();
      const org: Organisation = req.org;
      const userId: number = req.adminUserId;

      // Accept optional seatCount override from the onboarding flow.
      // This is the pre-Stripe seat selection; after checkout the webhook
      // syncs the authoritative quantity from the Stripe subscription item.
      const requestedSeats = req.body?.seatCount ? Math.max(1, Number(req.body.seatCount)) : null;
      if (requestedSeats !== null && requestedSeats !== org.seatCount) {
        await storage.updateOrganisation(org.id, { seatCount: requestedSeats });
      }
      const seatQty = requestedSeats ?? org.seatCount ?? 5;

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
        line_items: [{ price: priceId, quantity: seatQty }],
        success_url: `${baseUrl}/corporate/dashboard?setup=success`,
        cancel_url: `${baseUrl}/corporate/onboarding?step=checkout&cancelled=1`,
        metadata: { orgId: String(org.id) },
        subscription_data: { metadata: { orgId: String(org.id) } },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[Corporate Checkout]", err.message);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // ── POST /api/corporate/portal ────────────────────────────────────────────
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
        .filter((m: any) => m.status === "active" && m.userId !== null && m.userId !== req.adminUserId)
        .map((m: any) => m.userId as number);

      for (const uid of activeUserIds) {
        try { await storage.joinChallenge(challenge.id, uid); } catch {}
      }

      res.status(201).json(challenge);
    } catch (err: any) {
      console.error("[OrgChallenge]", err.message);
      res.status(500).json({ message: "Failed to create org challenge" });
    }
  });

  // ── DELETE /api/corporate/members/:id ───────────────────────────────────
  app.delete("/api/corporate/members/:id", requireOrgAdmin, async (req: any, res) => {
    try {
      const memberId = Number(req.params.id);
      const members = await storage.getOrgMembersByOrg(req.org.id);
      const member = members.find((m: any) => m.id === memberId);
      if (!member) return res.status(404).json({ message: "Member not found" });
      await storage.updateOrgMember(memberId, { status: "removed" });
      res.json({ message: "Member removed" });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  });
}

// ── Stripe webhook handler for corporate subscriptions ──────────────────────
export async function handleCorporateWebhookEvent(event: any) {
  if (!CORPORATE_ENABLED) return;
  const obj = event.data?.object;
  if (!obj) return;

  // Only handle events that carry our orgId metadata
  const orgId = obj.metadata?.orgId ? Number(obj.metadata.orgId) : null;
  if (!orgId) return;

  try {
    if (event.type === "checkout.session.completed") {
      if (obj.mode !== "subscription") return;
      await db.update(organisations)
        .set({ subscriptionStatus: "active" })
        .where(eq(organisations.id, orgId));
      console.log(`[Corporate] Org ${orgId} activated via checkout`);

    } else if (event.type === "customer.subscription.updated") {
      const status = obj.status === "active" || obj.status === "trialing" ? "active" : "inactive";

      // Sync seat count from Stripe subscription quantity — this is the
      // authoritative seat count; never accept client-supplied values.
      const items: Array<{ quantity?: number }> = (obj.items?.data as Array<{ quantity?: number }>) ?? [];
      const quantity = items[0]?.quantity ?? null;
      const subUpdates: Partial<InsertOrganisation> = { subscriptionStatus: status };
      if (quantity && quantity > 0) subUpdates.seatCount = quantity;

      await db.update(organisations).set(subUpdates).where(eq(organisations.id, orgId));
      console.log(`[Corporate] Org ${orgId} subscription updated → ${status}${quantity ? `, seats=${quantity}` : ""}`);

    } else if (event.type === "customer.subscription.deleted") {
      await db.update(organisations)
        .set({ subscriptionStatus: "cancelled" })
        .where(eq(organisations.id, orgId));
      console.log(`[Corporate] Org ${orgId} subscription cancelled`);
    }
  } catch (err: any) {
    console.error("[Corporate Webhook]", err.message);
  }
}
