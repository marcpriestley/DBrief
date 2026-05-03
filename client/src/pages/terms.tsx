import { useLocation } from "wouter";
import { ArrowLeft, FileText, CreditCard, Shield, AlertTriangle, Scale, User } from "lucide-react";

export default function TermsOfService() {
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
        <h1 className="text-base font-semibold text-foreground">Terms of Service</h1>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-8">

        {/* Intro */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Last updated: May 2026</p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            By creating an account or using DBrief App in any way, you agree to these Terms. If you do not agree, please do not use the app.
          </p>
        </div>

        <Section icon={<User className="h-4 w-4" />} title="1. Who We Are">
          <p className="text-sm text-foreground/75 leading-relaxed">
            DBrief App is a personal performance app operated by Marc Priestley. Questions about these Terms? Email us at{" "}
            <a href="mailto:marcpriestley@gmail.com" className="text-primary underline underline-offset-2">marcpriestley@gmail.com</a>.
          </p>
        </Section>

        <Section icon={<User className="h-4 w-4" />} title="2. Your Account">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>You must be at least 13 years old to use DBrief App.</li>
            <li>You are responsible for keeping your account credentials secure. We are not liable for any loss resulting from unauthorised access to your account.</li>
            <li>You may not create an account on behalf of someone else or use someone else's account.</li>
            <li>You may only hold one account. Creating multiple accounts to circumvent restrictions is not permitted.</li>
          </ul>
        </Section>

        <Section icon={<FileText className="h-4 w-4" />} title="3. Free and Premium Tiers">
          <div className="space-y-3 text-sm text-foreground/75 leading-relaxed">
            <div>
              <p className="font-medium text-foreground/90 mb-1">Free tier includes:</p>
              <p>AI text debriefs, daily performance scores, goals, habits, mood check-ins, history, basic trends, streaks, and journal.</p>
            </div>
            <div>
              <p className="font-medium text-foreground/90 mb-1">DBrief App Premium additionally includes:</p>
              <p>Voice Notes in Debriefs, Team section (Squad, Leaderboard, Challenges), Weekly Race Report, Data Pattern Analysis, and Mission Intelligence.</p>
            </div>
            <p>Premium features are clearly labelled in the app and require an active paid subscription.</p>
          </div>
        </Section>

        <Section icon={<CreditCard className="h-4 w-4" />} title="4. Subscriptions and Payment">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>DBrief App Premium is a monthly subscription, currently priced at <strong className="text-foreground/90">£5.99/month</strong> (introductory pricing, subject to change).</li>
            <li>Subscriptions are billed through the Apple App Store or directly via Stripe, depending on how you subscribe.</li>
            <li>Subscriptions automatically renew at the end of each billing period unless cancelled before the renewal date.</li>
            <li><strong className="text-foreground/90">Cancellation:</strong> Cancel any time via your Apple ID subscription settings or Settings → Manage Subscription in the app. Cancellation takes effect at the end of the current billing period — you retain Premium access until that date and will not be charged again.</li>
            <li><strong className="text-foreground/90">Refunds:</strong> We do not offer partial-period refunds. If you believe you have been charged in error, contact us within 14 days. Refunds for App Store purchases are handled by Apple under their own refund policy.</li>
            <li>Prices may change with reasonable notice. We will notify active subscribers before any price increase takes effect.</li>
          </ul>
        </Section>

        <Section icon={<FileText className="h-4 w-4" />} title="5. AI-Generated Content">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>DBrief App uses OpenAI's API to generate debrief responses, insights, and reports. AI responses are generated automatically and are not reviewed by a human before you see them.</li>
            <li>AI content is for informational and motivational purposes only. It is <strong className="text-foreground/90">not</strong> professional medical, psychological, financial, or fitness advice.</li>
            <li>Use your own judgement when acting on AI-generated suggestions. We are not responsible for decisions you make based on AI content.</li>
          </ul>
        </Section>

        <Section icon={<FileText className="h-4 w-4" />} title="6. Your Content">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>You retain ownership of all content you create in DBrief App, including journal entries, goals, and debrief responses.</li>
            <li>By using DBrief App, you grant us a limited licence to store, process, and (where required for AI features) transmit your content solely to operate the service.</li>
            <li>You must not use DBrief App to store or transmit any content that is illegal, harmful, defamatory, or that infringes the rights of others.</li>
          </ul>
        </Section>

        <Section icon={<AlertTriangle className="h-4 w-4" />} title="7. Acceptable Use">
          <p className="text-sm text-foreground/75 leading-relaxed mb-2">You agree not to:</p>
          <ul className="space-y-1.5 text-sm text-foreground/75">
            {[
              "Attempt to access, probe, or disrupt the DBrief App servers or infrastructure.",
              "Reverse engineer, decompile, or attempt to extract the source code of the app.",
              "Use automated tools to scrape, harvest, or interact with the service in ways it was not designed for.",
              "Share your account with others or resell access to DBrief App.",
              "Use DBrief App for any unlawful purpose.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground mt-2 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">We reserve the right to suspend or permanently terminate accounts that violate these rules without notice or refund.</p>
        </Section>

        <Section icon={<FileText className="h-4 w-4" />} title="8. Availability and Changes">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>We aim to keep DBrief App available at all times but do not guarantee uninterrupted access. Maintenance, updates, or events outside our control may cause temporary downtime.</li>
            <li>We reserve the right to modify, add, or remove features at any time. We will give reasonable notice of significant changes that affect paid subscribers.</li>
            <li>If we discontinue DBrief App, we will give reasonable advance notice and issue a pro-rata refund for any unused paid period.</li>
          </ul>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="9. Intellectual Property">
          <p className="text-sm text-foreground/75 leading-relaxed">
            All content, branding, and code comprising DBrief App (excluding your personal content) is owned by or licensed to us. You may not reproduce, redistribute, or create derivative works from it without our written permission.
          </p>
        </Section>

        <Section icon={<AlertTriangle className="h-4 w-4" />} title="10. Limitation of Liability">
          <ul className="space-y-2 text-sm text-foreground/75 leading-relaxed">
            <li>DBrief App is provided "as is" without warranties of any kind, express or implied.</li>
            <li>We are not liable for any indirect, incidental, consequential, or punitive damages arising from your use of, or inability to use, the app.</li>
            <li>Our total liability to you for any claim arising from these Terms shall not exceed the amount you paid us in the 12 months preceding the claim.</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Nothing in these Terms limits liability for death, personal injury, or fraud caused by our negligence.</p>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="11. Privacy">
          <p className="text-sm text-foreground/75 leading-relaxed">
            Your use of DBrief App is also governed by our{" "}
            <button
              onClick={() => window.location.href = "/privacy"}
              className="text-primary underline underline-offset-2"
            >
              Privacy Policy
            </button>
            , which is incorporated into these Terms by reference.
          </p>
        </Section>

        <Section icon={<Scale className="h-4 w-4" />} title="12. Governing Law">
          <p className="text-sm text-foreground/75 leading-relaxed">
            These Terms are governed by the laws of England and Wales. Any disputes arising from these Terms will be subject to the exclusive jurisdiction of the courts of England and Wales.
          </p>
        </Section>

        {/* Footer */}
        <div className="pt-4 border-t border-border/40 text-center space-y-1">
          <p className="text-xs text-muted-foreground">© 2026 Blue Suede Media Ltd. All rights reserved.</p>
          <p className="text-[11px] text-muted-foreground/60">
            Questions?{" "}
            <a href="mailto:marcpriestley@gmail.com" className="text-primary underline underline-offset-2">marcpriestley@gmail.com</a>
          </p>
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
