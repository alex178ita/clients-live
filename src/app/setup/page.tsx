'use client';

import { useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import type { ScopeGroup } from '@/lib/scopes';

interface Info {
  scopeString: string;
  groups: ScopeGroup[];
  config: {
    clientId: boolean;
    clientSecret: boolean;
    refreshToken: boolean;
    orgId: string;
    accountsDomain: string;
    apiDomain: string;
  };
}

interface CheckResult {
  product: string;
  label: string;
  scope: string;
  ok: boolean;
  status: number;
  message: string;
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn !px-2 !py-1 !text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function Flag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`chip ${ok ? 'bg-[#123524] text-[#5ddf9a]' : 'bg-[#3a1616] text-[#ff8f8f]'}`}>
      {children}
    </span>
  );
}

export default function SetupPage() {
  const [key, setKey] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [exchanging, setExchanging] = useState(false);
  const [exchangeError, setExchangeError] = useState<{ error: string; hint?: string } | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{
    ok: boolean;
    usingDeploymentToken: boolean;
    orgId: string;
    results: CheckResult[];
  } | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<{ error: string; hint?: string } | null>(null);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k');
    setKey(k);
    fetch(`/api/setup/info?k=${encodeURIComponent(k ?? '')}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setGateError(json?.error ?? 'Not available.');
          return;
        }
        setInfo(json as Info);
      })
      .catch((e) => setGateError(String(e)));
  }, []);

  const exchange = async (event: React.FormEvent) => {
    event.preventDefault();
    setExchanging(true);
    setExchangeError(null);
    setRefreshToken(null);
    try {
      const res = await fetch('/api/setup/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: key, code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExchangeError({ error: json?.error ?? 'Exchange failed.', hint: json?.hint });
        return;
      }
      setRefreshToken(json.refreshToken);
      setCode('');
    } finally {
      setExchanging(false);
    }
  };

  const diagnose = useCallback(
    async (useNewToken: boolean) => {
      setDiagnosing(true);
      setDiagnoseError(null);
      setDiagnosis(null);
      try {
        const res = await fetch('/api/setup/diagnose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            k: key,
            refreshToken: useNewToken ? refreshToken : undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDiagnoseError({ error: json?.error ?? 'Diagnostics failed.', hint: json?.hint });
          return;
        }
        setDiagnosis(json);
      } finally {
        setDiagnosing(false);
      }
    },
    [key, refreshToken],
  );

  if (gateError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <Logo className="mx-auto mb-4 h-8 w-auto" />
          <p className="text-sm text-[#ff8f8f]">{gateError}</p>
          <p className="mt-2 text-[11px] text-muted">
            The setup page needs <code>SETUP_KEY</code> set on the deployment and the matching{' '}
            <code>?k=</code> in the URL.
          </p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="spinner" />
      </main>
    );
  }

  const { config } = info;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <Logo className="h-8 w-auto" />
        <div>
          <h1 className="text-xl font-semibold text-white">Zoho token setup</h1>
          <p className="text-xs italic text-muted">Won Deals &amp; Billing Plan — v.0.1</p>
        </div>
      </header>

      {/* Deployment configuration ----------------------------------- */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-white">This deployment</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Flag ok={config.clientId}>ZOHO_CLIENT_ID</Flag>
          <Flag ok={config.clientSecret}>ZOHO_CLIENT_SECRET</Flag>
          <Flag ok={config.refreshToken}>ZOHO_REFRESH_TOKEN</Flag>
          <Flag ok={Boolean(config.orgId)}>ZOHO_ORG_ID {config.orgId || '(missing)'}</Flag>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Accounts: {config.accountsDomain} · API: {config.apiDomain}. Values are never shown here,
          only whether they are set.
        </p>
      </section>

      {/* Scopes ------------------------------------------------------ */}
      <section className="card p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">1. Scopes</h2>
          <CopyButton value={info.scopeString} label="Copy scope string" />
        </div>
        <p className="mb-2 text-xs text-muted">
          Paste this into the Zoho self client exactly as it is — commas, no spaces, no line breaks.
          Broken onto several lines it fuses into one invalid scope and Zoho answers{' '}
          <em>Invalid scope</em>.
        </p>
        <textarea
          readOnly
          value={info.scopeString}
          rows={4}
          className="input w-full font-mono text-[11px] leading-relaxed"
          onFocus={(e) => e.currentTarget.select()}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted hover:text-white">
            What each scope is for
          </summary>
          <div className="mt-2 space-y-3">
            {info.groups.map((group) => (
              <div key={group.product}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.label}
                </h3>
                <ul className="mt-1 space-y-0.5">
                  {group.scopes.map((scope) => (
                    <li key={scope.name} className="text-xs">
                      <code className="text-[#7cc4ff]">{scope.name}</code>{' '}
                      <span className="text-muted">— {scope.why}</span>
                      {scope.future && (
                        <span className="ml-1 chip bg-[#2a2a2a] text-[#b9b9b9]">future</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* Exchange ---------------------------------------------------- */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-white">2. Turn the code into a refresh token</h2>
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>
            Open the Zoho API console, pick the <strong>same client</strong> whose id and secret are
            on this deployment, and go to <strong>Self Client</strong>.
          </li>
          <li>Paste the scope string above, set the duration to 10 minutes, generate the code.</li>
          <li>Paste that code here within those minutes — it works once.</li>
        </ol>
        <form onSubmit={exchange} className="flex flex-wrap gap-2">
          <input
            className="input flex-1 font-mono text-xs"
            placeholder="1000.xxxxxxxx…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={exchanging || !code.trim()}>
            {exchanging ? 'Exchanging…' : 'Exchange'}
          </button>
        </form>

        {exchangeError && (
          <div className="mt-3 rounded-md border border-[#5a2020] bg-[#241414] p-3 text-sm text-[#ff8f8f]">
            {exchangeError.error}
            {exchangeError.hint && (
              <div className="mt-1 text-[11px] text-[#e6a0a0]">{exchangeError.hint}</div>
            )}
          </div>
        )}

        {refreshToken && (
          <div className="mt-3 rounded-md border border-[#1d4429] bg-[#0f2418] p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium text-[#5ddf9a]">Refresh token</span>
              <CopyButton value={refreshToken} />
            </div>
            <code className="block break-all font-mono text-[11px] text-[#e6edf3]">
              {refreshToken}
            </code>
            <p className="mt-2 text-[11px] text-muted">
              Shown here once and stored nowhere. Put it in <code>ZOHO_REFRESH_TOKEN</code> on
              Vercel, then <strong>redeploy</strong> — environment variables only reach a new
              deployment. This token is permanent unless it is revoked, or pushed out by generating
              several more for the same user.
            </p>
          </div>
        )}
      </section>

      {/* Diagnostics -------------------------------------------------- */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-white">3. Check what the token can do</h2>
        <p className="mb-3 text-xs text-muted">
          One real read per product. This is what tells you a scope is missing before the dashboard
          does.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => diagnose(false)}
            disabled={diagnosing || !config.refreshToken}
          >
            {diagnosing ? 'Checking…' : 'Test the deployment token'}
          </button>
          {refreshToken && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => diagnose(true)}
              disabled={diagnosing}
            >
              {diagnosing ? 'Checking…' : 'Test the new token'}
            </button>
          )}
        </div>

        {diagnoseError && (
          <div className="mt-3 rounded-md border border-[#5a2020] bg-[#241414] p-3 text-sm text-[#ff8f8f]">
            {diagnoseError.error}
            {diagnoseError.hint && (
              <div className="mt-1 text-[11px] text-[#e6a0a0]">{diagnoseError.hint}</div>
            )}
          </div>
        )}

        {diagnosis && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-muted">
              {diagnosis.usingDeploymentToken
                ? 'Using the token this deployment runs on'
                : 'Using the token you just generated'}{' '}
              · organisation {diagnosis.orgId}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {diagnosis.results.map((result) => (
                  <tr key={result.label} className="border-t border-line/60">
                    <td className="py-1.5 pr-3 align-top">
                      <Flag ok={result.ok}>{result.ok ? 'ok' : 'fail'}</Flag>
                    </td>
                    <td className="py-1.5 pr-3 align-top">{result.label}</td>
                    <td className="py-1.5 align-top">
                      <code className="text-[11px] text-[#7cc4ff]">{result.scope}</code>
                      {!result.ok && (
                        <div className="text-[11px] text-[#ff8f8f]">
                          {result.message} {result.status ? `(HTTP ${result.status})` : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!diagnosis.ok && (
              <p className="mt-2 text-[11px] text-muted">
                A failing line means that permission is not on the token — scopes cannot be added
                afterwards, so generate a new code with the full string above and exchange it again.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
