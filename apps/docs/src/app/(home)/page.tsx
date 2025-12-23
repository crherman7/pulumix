import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1 px-4 py-16">
      <h1 className="text-5xl font-bold mb-4">Pulumix</h1>
      <p className="text-xl text-fd-muted-foreground mb-2 max-w-2xl">
        Build and deploy federated services on Kubernetes with TypeScript
      </p>
      <p className="text-fd-muted-foreground mb-8 max-w-2xl">
        Discover services across your monorepo, build Docker images, and deploy
        them in dependency order. Share and compose infrastructure like npm
        packages.
      </p>

      <div className="flex gap-4 mb-12">
        <Link
          href="/docs"
          className="px-6 py-3 bg-fd-primary text-fd-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Get Started
        </Link>
        <Link
          href="/docs/cli"
          className="px-6 py-3 border border-fd-border rounded-lg font-medium hover:bg-fd-accent transition-colors"
        >
          CLI Reference
        </Link>
      </div>

      <div className="bg-fd-card border border-fd-border rounded-lg p-4 font-mono text-sm">
        <code>npm install -g @pulumix/cli</code>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-4xl">
        <FeatureCard
          title="Auto-Discovery"
          description="Glob-based discovery finds services anywhere in your monorepo. No configuration needed."
        />
        <FeatureCard
          title="Federated Services"
          description="Publish services to npm. Share infrastructure across teams and repos."
        />
        <FeatureCard
          title="Type-Safe Contracts"
          description="Export TypeScript interfaces. Get IntelliSense when wiring services together."
        />
        <FeatureCard
          title="Smart Build Caching"
          description="Content-based hashing skips unchanged services. Images referenced by digest."
        />
        <FeatureCard
          title="Local Dev with HMR"
          description="Run services locally with hot reload. Ingress routes to your machine."
        />
        <FeatureCard
          title="Built on Pulumi"
          description="Full access to Pulumi SDK. Any cloud, any resource."
        />
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 border border-fd-border rounded-lg text-left">
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-fd-muted-foreground">{description}</p>
    </div>
  );
}
