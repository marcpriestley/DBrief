// ── Corporate Tier Schema ─────────────────────────────────────────────────────
// This file is intentionally separate from shared/schema.ts so that the
// default `npm run db:push` command (which reads drizzle.config.ts →
// shared/schema.ts) does NOT create these tables in environments where
// CORPORATE_TIER_ENABLED is absent.
//
// To migrate corporate tables when enabling the tier, run:
//   npx drizzle-kit push --config=drizzle-corporate.config.ts
//
// Application routes, UI pages, and webhook handlers are all guarded by the
// CORPORATE_TIER_ENABLED / VITE_CORPORATE_TIER_ENABLED env flags so the
// feature is fully inert at both the schema and application layers when
// the flag is not set.

import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, challenges } from "./schema";

export const organisations = pgTable("organisations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  accentColour: text("accent_colour").default("#d97706"),
  aiPersonaName: text("ai_persona_name").default("Performance Engineer"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  seatCount: integer("seat_count").default(5),
  adminUserId: integer("admin_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  inviteToken: text("invite_token").unique(),
  joinedAt: timestamp("joined_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgChallenges = pgTable("org_challenges", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  challengeId: integer("challenge_id").notNull().references(() => challenges.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOrganisationSchema = createInsertSchema(organisations).omit({
  id: true,
  createdAt: true,
});
export const insertOrgMemberSchema = createInsertSchema(orgMembers).omit({
  id: true,
  createdAt: true,
  joinedAt: true,
});
export const insertOrgChallengeSchema = createInsertSchema(orgChallenges).omit({
  id: true,
  createdAt: true,
});

export type Organisation = typeof organisations.$inferSelect;
export type InsertOrganisation = z.infer<typeof insertOrganisationSchema>;
export type OrgMember = typeof orgMembers.$inferSelect;
export type InsertOrgMember = z.infer<typeof insertOrgMemberSchema>;
export type OrgChallenge = typeof orgChallenges.$inferSelect;

export const organisationsRelations = relations(organisations, ({ one, many }) => ({
  admin: one(users, { fields: [organisations.adminUserId], references: [users.id] }),
  members: many(orgMembers),
  challenges: many(orgChallenges),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organisation: one(organisations, { fields: [orgMembers.orgId], references: [organisations.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));

export const orgChallengesRelations = relations(orgChallenges, ({ one }) => ({
  organisation: one(organisations, { fields: [orgChallenges.orgId], references: [organisations.id] }),
  challenge: one(challenges, { fields: [orgChallenges.challengeId], references: [challenges.id] }),
}));

export type OrgMemberUpdate = {
  userId?: number | null;
  status?: string;
  inviteToken?: string | null;
  role?: string;
  joinedAt?: Date | null;
};

export type OrgMemberWithUser = OrgMember & {
  displayName: string | null;
  driverHandle: string | null;
  currentStreak: number;
  sevenDayConsistency: number;
};
