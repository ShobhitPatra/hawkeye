import { CopyButton } from "../../copy-button";

export function TokenShown({ token, controlPlaneUrl }: { token: string; controlPlaneUrl: string }) {
  const command = `npx hawkeye-review runner login --url ${controlPlaneUrl} --token ${token}`;
  return (
    <div className="hk-section hk-arrive">
      <div className="hk-code-row">
        <pre className="hk-code">{token}</pre>
        <CopyButton text={token} />
      </div>
      <p className="hk-compact hk-muted">
        Copy it now. It will not be shown again. On the runner machine:
      </p>
      <div className="hk-code-row">
        <pre className="hk-code">{command}</pre>
        <CopyButton text={command} />
      </div>
      <p className="hk-compact hk-muted">
        Then start it with <span className="hk-mono">npx hawkeye-review runner</span>.
      </p>
    </div>
  );
}
