import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage, Section, Table } from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy · Clardentity",
  description: "What Clardentity collects, why, who it goes to, and what you can do about it.",
};

/* Kept in step with backend settings.terms_version: the account row records
   which version was accepted, and that is only meaningful if the number here
   is the one people saw. */
const VERSION = "2026-10-23";
const UPDATED = "23 October 2026";
const CONTACT = "hello@clardentity.ai";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      version={VERSION}
      updated={UPDATED}
      intro={
        <>
          Clardentity is built on the idea that you should be able to see what an answer rests
          on. The same applies to what we hold about you. This policy says what we collect, why
          we collect it, who else sees it and how to make us delete it - in plain words, with
          the specifics rather than the usual hedging.
        </>
      }
    >
      <Section n={1} title="Who we are">
        <p>
          Clardentity (&quot;we&quot;, &quot;us&quot;) provides an AI companion that answers
          questions and shows the sources behind each claim. For the purposes of the UK and EU
          General Data Protection Regulation and India&apos;s Digital Personal Data Protection
          Act 2023, we are the data controller for the information described here.
        </p>
        <p>
          Questions, requests, or complaints: <a className="text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section n={2} title="What we collect">
        <Table
          head={["What", "Examples", "Why"]}
          rows={[
            [
              "Account details",
              "Email address, password (stored only as a one-way hash), display name if you give one, the date you accepted these terms",
              "To create and secure your account",
            ],
            [
              "What you write",
              "Your questions, the answers, any follow-up answers you give, and chat names",
              "To answer you, and to keep your conversations so you can come back to them",
            ],
            [
              "Files you attach",
              "PDFs, Word, Excel, PowerPoint, text files, images; their extracted text and the numeric embeddings made from it",
              "To answer questions about them and cite them",
            ],
            [
              "Voice",
              "Audio you record in the composer, and its transcript",
              "To turn speech into the question you asked",
            ],
            [
              "Health information",
              "Symptoms, test results, conditions and medicines you ask about in Healthcare",
              "Only to answer you, and only after your explicit consent - see section 6",
            ],
            [
              "Safety screening",
              "Whether a message suggests someone may be in danger (a level such as \u201cconcern\u201d, not the message), kept with the answer it changed",
              "To show local emergency and crisis numbers when someone may need them",
            ],
            [
              "Approximate location",
              "City and country, derived from your IP address at sign-in. We do not store the IP address itself or any coordinates",
              "So regional questions get regional answers (prices, rules, weather), and so Healthcare follows the health-data rules and gives the emergency numbers for where you are",
            ],
            [
              "Language and time zone",
              "The language preferences and time zone your browser already reports, sent when you start a voice call. Not stored",
              "So the voice speaks your language the way it is spoken where you are, rather than with an accent laid over it",
            ],
            [
              "Technical records",
              "Server logs with timestamps, endpoints, error traces and per-request timings",
              "To keep the service running and diagnose faults",
            ],
            [
              "Product analytics",
              "Named events such as “a question was asked in Finder mode”, with no content in them - see section 8",
              "To learn which features are used and where people get stuck",
            ],
          ]}
        />
        <p>
          We do not ask for, and ask that you do not send, government identifiers or payment card
          numbers - or health information anywhere except Healthcare, which asks for your consent
          first. Healthcare is for adults: 18, or older where the age of majority where you live
          is higher. We do not knowingly collect anything from children under 16.
        </p>
      </Section>

      <Section n={3} title="Why we are allowed to (legal bases)">
        <p>
          Under the GDPR we rely on: <strong>performance of a contract</strong> for everything
          needed to run your account and answer your questions; <strong>legitimate interests</strong>
          {" "}for keeping the service secure and diagnosing faults; and{" "}
          <strong>consent</strong> for product analytics, which you can give or refuse in the
          banner and change at any time. Health information is special-category data, and for it
          we rely on your <strong>explicit consent</strong> (Article 9(2)(a)), asked separately
          before your first Healthcare conversation. Under India&apos;s DPDP Act we rely on the consent you
          give when you create an account and on the legitimate uses that Act permits for
          providing a service you asked for.
        </p>
      </Section>

      <Section n={4} title="Where your questions go">
        <p>
          Answering a question means sending it to other companies. This is the part most
          policies are vague about, so here is the actual list. Each is bound by a contract that
          restricts what it may do with the data.
        </p>
        <Table
          head={["Processor", "What it receives", "Where"]}
          rows={[
            ["Anthropic", "Your question, the recent conversation, any attached text, to generate an answer", "United States"],
            ["OpenAI", "The same, when used as a fallback; audio for transcription; text for embeddings; your description, and any picture you attach, when you ask Co-Creative for an image", "United States"],
            ["Google", "Your question and the recent conversation, only when you pick a Gemini model in Co-Creative. If you sign in with Google, Google tells us your name and email address", "United States"],
            ["xAI", "Your question and the recent conversation, only when you pick a Grok model in Co-Creative", "United States"],
            ["ipapi.co", "Your IP address, to work out your country for the local rules and support numbers in section 6", "United States"],
            ["Tavily", "Search queries derived from your question - not the question verbatim", "United States"],
            ["Supabase", "The database and file storage: accounts, conversations, documents, claims", "South Korea (Seoul)"],
            ["Render", "The application servers that process every request", "Singapore"],
            ["Vercel", "Serves the web app; sees requests for pages, not your conversations", "Global edge"],
            ["Upstash", "Rate-limit counters and background job queue - identifiers, not content", "Configured region"],
            ["Resend", "Your email address, to send password resets and welcome mail", "United States"],
            ["PostHog", "Analytics events with no content, only if you consent (section 8)", "European Union"],
          ]}
        />
        <p>
          Anthropic and OpenAI do not use business API data to train their models under their
          standard API terms. We do not sell your data, and we do not share it for advertising.
        </p>
      </Section>

      <Section n={5} title="International transfers">
        <p>
          Our servers are in Singapore, our database is in South Korea, and the AI models that
          write answers run in the United States - so what you send leaves the UK, the EU and
          India. Where personal data leaves those areas we rely on the transfer mechanisms our
          providers offer - Standard Contractual Clauses and, where applicable, the EU-US Data
          Privacy Framework (and, for South Korea, the EU&apos;s adequacy decision). India&apos;s
          Digital Personal Data Protection Act allows transfers to any country the Government
          has not restricted; none of these is.
        </p>
      </Section>

      <Section n={6} title="Health information and support">
        <p>
          <strong>Healthcare asks before it answers.</strong> Before your first health
          conversation it shows what will happen to what you share, under the rules for where you
          are, and asks for your explicit consent. We record when you gave it and which version
          of that text you saw, and in which language (in India it can be read in English or
          Hindi); if the text changes, it asks again. You can withdraw consent at any time in
          Settings → Healthcare, and withdrawing deletes every chat that has a Healthcare message
          in it.
        </p>
        <p>
          <strong>The rules of where you are apply.</strong> We work out your country (and, in
          some countries, your state or province) from your connection, and Healthcare follows
          that place&apos;s health-data rules. Where those rules do not allow health information
          to be stored outside the country, Healthcare runs only as a temporary chat - nothing is
          kept once you leave it. Where they do not allow the service at all, Healthcare is not
          offered there.
        </p>
        <p>
          <strong>Used to answer you, and for nothing else.</strong> Health information is sent
          to the same AI providers as any question (section 4), under the same contracts. It is
          never used to build your profile or memory, never used for advertising, and never
          sent to analytics. A Healthcare conversation in the free demo on our home page is kept
          only in your browser and is not carried into an account when you sign up.
        </p>
        <p>
          <strong>Safety screening.</strong> Every message, in every mode, is checked by an AI
          model for signs that someone may be in danger. When a message is flagged, the answer
          puts their safety first and shows emergency and crisis numbers for your country,
          taken from a table we maintain - never made up by the model. We keep only the level
          (&quot;concern&quot; or &quot;crisis&quot;) with that answer, so the numbers are still
          there when you come back to it. Clardentity is not a crisis service and does not
          contact anyone on your behalf.
        </p>
      </Section>

      <Section n={7} title="How long we keep it">
        <p>
          Your account, conversations and files stay until you delete them. Deleting a chat
          removes its messages, claims and citations. Deleting your account (Profile → delete
          account) removes the account, its workspaces, conversations, documents, uploaded files
          and memory - immediately and irreversibly. Temporary chats, including Healthcare
          where it runs only that way, are deleted when you leave them. Server logs are kept for up to 30 days.
          Analytics events, if you consented, are kept for up to 12 months.
        </p>
      </Section>

      <Section n={8} title="Analytics and cookies">
        <p>
          We store one thing on your device without asking: the tokens that keep you signed in.
          Without them the app cannot work, so they are strictly necessary and carry no consent
          requirement.
        </p>
        <p>
          Product analytics are different, and are <strong>off until you say yes</strong>. If
          you accept, we record named events - a question was asked, in which mode, whether a
          file was attached, roughly how long the answer took - through PostHog on its European
          servers. These events never contain your questions, your answers, chat names, file
          names or your email address; you appear as a random account identifier. For Guidance
          and Healthcare not even the mode is recorded - those events say only
          &quot;sensitive&quot;. Session
          recording and automatic click-capture are switched off in our code, not merely in a
          setting. You can change your mind at any time from the link in the footer of the
          banner or by clearing site data.
        </p>
      </Section>

      <Section n={9} title="Your rights">
        <p>
          You can ask us to give you a copy of your data, correct it, delete it, restrict or
          object to how we use it, or hand it to another provider. Two of these you can do
          yourself, immediately: export any conversation from the chat menu, and delete your
          account from your profile. For anything else, write to{" "}
          <a className="text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> and
          we will respond within 30 days.
        </p>
        <p>
          If you think we have handled your data badly, you may complain to your local
          supervisory authority - the Information Commissioner&apos;s Office in the UK, your
          national authority in the EU, or the Data Protection Board of India.
        </p>
        <p>
          <strong>Grievances (India).</strong> Under India&apos;s Information Technology
          (Reasonable Security Practices and Procedures and Sensitive Personal Data or
          Information) Rules, 2011 and the Digital Personal Data Protection Act, 2023, write to
          our Grievance Officer at{" "}
          <a className="text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. We
          acknowledge every grievance and resolve it within one month. If we do not, you can
          complain to the Data Protection Board of India.
        </p>
      </Section>

      <Section n={10} title="Security">
        <p>
          Traffic is encrypted in transit. Passwords are stored as one-way hashes and never in
          readable form. Access to the production database is limited to the people who operate
          the service. No system is perfect: if a breach affects your data we will tell you and
          the relevant authority within the timeframes the law sets.
        </p>
      </Section>

      <Section n={11} title="Changes">
        <p>
          If we change this policy materially we will raise the version number, show the change
          when you next sign in, and ask you to accept it again where the law requires. The
          version you accepted is recorded against your account.
        </p>
        <p className="pt-2">
          See also our <Link className="text-brand hover:underline" href="/terms">Terms of Service</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
