import { CodeBlock } from "../../code-block";

export function TokenShown({ token, controlPlaneUrl }: { token: string; controlPlaneUrl: string }) {
  const command = `npx hawkeye-review runner login --url ${controlPlaneUrl} --token ${token}`;
  return (
    <div className="hk-section hk-arrive">
      <CodeBlock text={token} />
      <p className="hk-compact hk-muted">
        Copy it now. It will not be shown again. On the runner machine:
      </p>
      <CodeBlock text={command} />
      <p className="hk-compact hk-muted">
        Then start it with <span className="hk-mono">npx hawkeye-review runner</span>.
      </p>
    </div>
  );
}
