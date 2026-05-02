import { useLocation } from "wouter";
import { ArrowLeft, Lock, Shield, Eye, Server, Trash2 } from "lucide-react";

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border/50 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation("/")}
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-foreground" />
        </button>
        <h1 className="text-base font-semibold text-foreground">Privacy Policy</h1>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-8">

        {/* Intro */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Last updated: May 2026</p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            DBrief is built around honest self-reflection. For that to work, you need to trust that
            what you write stays private. This policy explains exactly what we collect, what we do
            with it, and the technical measures we use to protect it.
          </p>
        </div>

        {/* Encryption callout */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <Lock className="h-3 w-3 text-emerald-500" />
            </div>
            <span className="text-sm font-semibold text-emerald-500">AES-256-GCM Encryption</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your most personal content — journal entries, debrief conversations, AI summaries,
            your infinite goal, and long-term targets — is encrypted at rest using AES-256-GCM
            before being written to our database. This is the same standard used by banks and
            governments. Even in the unlikely event of a database breach, your writing is
            unreadable without your unique encryption key.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[
              "Journal entries & voice notes",
              "Debrief conversations",
              "AI summaries & insights",
              "Infinite goal & long-term targets",
            ].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[11px] text-foreground/70">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sections */}
        <Section icon={<Eye className="h-4 w-4" />} title="What We Collect">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li><strong className="text-foreground/90">Account:</strong> Your email address and a secure hash of your password. We never store your password in plain text.</li>
            <li><strong className="text-foreground/90">Performance data:</strong> The metric scores (0–100) you log each day — sleep, energy, focus, and any custom metrics you add.</li>
            <li><strong className="text-foreground/90">Journal & debrief content:</strong> Text you write in the journal or during AI debrief sessions. Stored encrypted.</li>
            <li><strong className="text-foreground/90">Goals:</strong> Your infinite goal, long-term targets, and daily goals. Stored encrypted.</li>
            <li><strong className="text-foreground/90">Mood check-ins:</strong> Mood ratings you submit through the app.</li>
            <li><strong className="text-foreground/90">Streak & activity data:</strong> Timestamps of when you log, used to calculate streaks and consistency scores.</li>
            <li><strong className="text-foreground/90">Push tokens:</strong> Device tokens used solely to send your daily reminders if you opt in. Never used for marketing.</li>
            <li><strong className="text-foreground/90">Habits & squad data:</strong> Habit names, completion logs, and connection relationships for the Team feature.</li>
          </ul>
        </Section>

        <Section icon={<Server className="h-4 w-4" />} title="How We Use It">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>To run the DBrief service and personalise it to you.</li>
            <li>To generate AI debrief responses and insights via OpenAI. Only the content needed to generate your response is sent — it is not used to train AI models.</li>
            <li>To send your daily reminders (morning and evening), if enabled.</li>
            <li>To calculate your performance trends, streak, and consistency data.</li>
            <li>To power the Team leaderboard and challenge features (streak, consistency %, and points only — journal and debrief content is never shared).</li>
          </ul>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="Third-Party Services">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>
              <strong className="text-foreground/90">OpenAI</strong> — powers AI conversations and insights. Data sent is limited to what is needed for your response.{" "}
              <a href="https://openai.com/privacy" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">OpenAI Privacy Policy →</a>
            </li>
            <li>
              <strong className="text-foreground/90">Stripe</strong> — processes subscription payments. We never see or store your card details.{" "}
              <a href="https://stripe.com/privacy" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">Stripe Privacy Policy →</a>
            </li>
            <li>
              <strong className="text-foreground/90">Replit</strong> — our hosting infrastructure.{" "}
              <a href="https://replit.com/privacy" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">Replit Privacy Policy →</a>
            </li>
            <li>
              <strong className="text-foreground/90">Apple Push Notifications (APNs)</strong> — used only to deliver your daily reminders on iOS. No content is transmitted.
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Your data is never sold to or shared with any third party for advertising or analytics purposes.
          </p>
        </Section>

        <Section icon={<Trash2 className="h-4 w-4" />} title="Data Retention & Deletion">
          <div className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <p>Your data is kept for as long as your account is active. You can delete your account at any time from <strong className="text-foreground/90">Settings → Danger Zone</strong>. This permanently and immediately removes your account, all journal entries, debriefs, goals, habits, and performance data.</p>
            <p>You can also contact us to request a data export or to exercise any of the rights listed below.</p>
          </div>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="Your Rights">
          <p className="text-sm text-foreground/75 leading-relaxed mb-3">
            Depending on your location (including under UK GDPR and CCPA), you may have the right to:
          </p>
          <ul className="space-y-1.5 text-sm text-foreground/75">
            <li className="flex items-start gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>Access the personal data we hold about you</span></li>
            <li className="flex items-start gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>Request correction of inaccurate data</span></li>
            <li className="flex items-start gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>Request deletion of your account and all data</span></li>
            <li className="flex items-start gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>Object to or restrict certain processing</span></li>
            <li className="flex items-start gap-2"><div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>Data portability — a copy of your data in a machine-readable format</span></li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            To exercise any of these rights, email us at{" "}
            <a href="mailto:marcpriestley@gmail.com" className="text-primary underline underline-offset-2">marcpriestley@gmail.com</a>.
            We will respond within 30 days.
          </p>
        </Section>

        <Section icon={<Eye className="h-4 w-4" />} title="Children's Privacy">
          <p className="text-sm text-foreground/75 leading-relaxed">
            DBrief is not directed at anyone under the age of 13. We do not knowingly collect data from children under 13. If you believe a child has provided personal information, contact us and we will delete it promptly.
          </p>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="Changes to This Policy">
          <p className="text-sm text-foreground/75 leading-relaxed">
            We may update this policy as the app evolves. Significant changes will be flagged by updating the date at the top of this page. Continued use after changes constitutes acceptance of the updated policy.
          </p>
        </Section>

        {/* Footer */}
        <div className="pt-4 border-t border-border/40 text-center space-y-1">
          <p className="text-xs text-muted-foreground">© 2026 DBrief. All rights reserved.</p>
          <p className="text-[11px] text-muted-foreground/60">Questions? <a href="mailto:marcpriestley@gmail.com" className="text-primary underline underline-offset-2">marcpriestley@gmail.com</a></p>
        </div>

      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
          {icon}
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="pl-8">
        {children}
      </div>
    </div>
  );
}
