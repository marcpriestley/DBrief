export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-gray-900 mb-2">DBrief Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Last updated: March 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Overview</h2>
            <p>
              DBrief ("we", "our", or "us") is committed to protecting your personal information.
              This policy explains what data we collect, how we use it, and what rights you have
              over it. We collect only what is necessary to deliver the service and never sell
              your data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Data We Collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Account information:</strong> Your email address and password (stored as a secure hash) when you create an account.</li>
              <li><strong>Performance data:</strong> Daily metric scores (0–100 scale) you choose to log, including sleep, energy, focus, and other custom metrics.</li>
              <li><strong>Journal and debrief content:</strong> Text you write in your daily journal or during AI debrief sessions.</li>
              <li><strong>Goals:</strong> Your infinite goal, long-term targets, and daily job list.</li>
              <li><strong>Mood check-ins:</strong> Mood ratings you submit through the app.</li>
              <li><strong>Usage data:</strong> Streak counts and activity timestamps used to power your streak tracking.</li>
              <li><strong>Push notification tokens:</strong> Device tokens used to deliver your daily reminders, if you opt in.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Encryption</h2>
            <p>
              Sensitive content — including your journal entries, debrief conversations, AI summaries,
              infinite goal, and long-term targets — is encrypted at rest using AES-256-GCM encryption
              before being stored in our database. This means that even in the unlikely event of a
              database breach, your personal writing cannot be read.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To provide and personalise the DBrief service.</li>
              <li>To generate AI-powered debrief conversations and performance insights using OpenAI's API. Your data is sent to OpenAI solely to generate your responses and is not used to train OpenAI models.</li>
              <li>To send daily reminders if you have enabled push notifications.</li>
              <li>To calculate your performance trends and streak data.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Third-Party Services</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>OpenAI:</strong> Used to power AI debrief conversations and insights. Data shared is limited to what is needed to generate your response. See <a href="https://openai.com/privacy" className="text-amber-600 underline" target="_blank" rel="noreferrer">OpenAI's Privacy Policy</a>.</li>
              <li><strong>Replit:</strong> Our hosting and infrastructure provider. See <a href="https://replit.com/privacy" className="text-amber-600 underline" target="_blank" rel="noreferrer">Replit's Privacy Policy</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Data Retention</h2>
            <p>
              Your data is retained for as long as your account is active. You may request deletion
              of your account and all associated data at any time by contacting us at the email below.
              We will process deletion requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your account and data.</li>
              <li>Object to or restrict certain processing of your data.</li>
              <li>Data portability — receive a copy of your data in a machine-readable format.</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, contact us at the email address below.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Children's Privacy</h2>
            <p>
              DBrief is not directed at children under the age of 13. We do not knowingly collect
              personal information from children under 13. If you believe a child has provided us
              with personal information, please contact us and we will delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. We will notify you of significant changes
              by updating the date at the top of this page. Continued use of the app after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">Contact</h2>
            <p>
              For any privacy-related questions or requests, contact us at:{" "}
              <a href="mailto:marcpriestley@gmail.com" className="text-amber-600 underline">
                marcpriestley@gmail.com
              </a>
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-gray-400 text-xs text-center">© 2026 DBrief. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
