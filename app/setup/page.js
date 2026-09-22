'use client';

import { useCallback, useEffect, useState } from 'react';
import { buildStamp } from '../../lib/build-stamp';

export default function SetupPage() {
  const [authorised, setAuthorised] = useState(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [passwordConfigured, setPasswordConfigured] = useState(true);

  const [meta, setMeta] = useState(null);
  const [dc, setDc] = useState('eu');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [copied, setCopied] = useState('');

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((json) => {
        setAuthorised(Boolean(json.authorised));
        setPasswordConfigured(json.configured !== false);
      })
      .catch(() => setAuthorised(false));
  }, []);

  const loadMeta = useCallback(() => {
    fetch('/api/setup/meta')
      .then((r) => r.json())
      .then((json) => {
        if (json.dataCentres) setMeta(json);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (authorised) loadMeta();
  }, [authorised, loadMeta]);

  async function submitPassword(event) {
    event.preventDefault();
    setAuthError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      setPassword('');
      setAuthorised(true);
    } else {
      setAuthError('Wrong password.');
    }
  }

  async function diagnose() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const res = await fetch('/api/setup/diagnose');
      setDiagnosis(await res.json());
    } catch (err) {
      setDiagnosis({ ok: false, message: String(err.message || err) });
    } finally {
      setDiagnosing(false);
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1800);
    } catch (err) {
      setCopied('');
    }
  }

  async function exchange(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/setup/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, code, dc })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json);
      } else {
        setResult(json);
        setCode('');
      }
    } catch (err) {
      setError({ error: String(err.message || err) });
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!result) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/setup/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken: result.refreshToken,
          apiHost: result.apiDomain,
          dc
        })
      });
      setTestResult(await res.json());
    } catch (err) {
      setTestResult({ error: String(err.message || err) });
    } finally {
      setTesting(false);
    }
  }

  if (authorised === null) {
    return (
      <div className="splash">
        <img src="/kleecks-logo-white.png" alt="Kleecks" />
        <p>Loading ... please wait ...</p>
      </div>
    );
  }

  if (!authorised) {
    return (
      <div className="gate">
        <form onSubmit={submitPassword}>
          <h2>Setup — Zoho connection</h2>
          {passwordConfigured ? (
            <p>Enter the app password to continue.</p>
          ) : (
            <p className="error">
              APP_PASSWORD is not set on this deployment. Add it in the Vercel
              environment variables and redeploy, then come back here.
            </p>
          )}
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
          <div style={{ height: 12 }} />
          <button className="primary" type="submit" disabled={!passwordConfigured}>Continue</button>
          {authError ? <p className="error">{authError}</p> : null}
        </form>
      </div>
    );
  }

  const centres = (meta && meta.dataCentres) || [];
  const chosen = centres.find((c) => c.key === dc) || null;
  const scopeString = (meta && meta.scopeString) || 'ZohoCRM.coql.READ,ZohoCRM.modules.deals.READ,ZohoCRM.users.READ';

  const envBlock = result
    ? [
        `ZOHO_CLIENT_ID=${clientId}`,
        `ZOHO_CLIENT_SECRET=${clientSecret}`,
        `ZOHO_REFRESH_TOKEN=${result.refreshToken}`,
        `ZOHO_ACCOUNTS_HOST=${result.dc.accounts}`,
        `ZOHO_API_HOST=${result.dc.api}`,
        `NEXT_PUBLIC_CRM_BASE_URL=${result.dc.crm}/crm/tab/Potentials`
      ].join('\n')
    : '';

  return (
    <>
      <header className="masthead">
        <img src="/kleecks-logo-white.png" alt="Kleecks" />
        <h1>Setup — Zoho connection</h1>
        <p className="version">{buildStamp()}</p>
      </header>

      <main className="setup">
        <p className="lead">
          This page turns a Self Client grant code into the permanent refresh token, then checks it
          against the CRM before you save anything. Nothing typed here is stored on the server: the
          values come straight back to this page for you to paste into the Vercel variables.
        </p>

        {meta ? (
          <div className="status-strip">
            {['APP_PASSWORD', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'].map((name) => (
              <span key={name} className={`chip ${meta.configured[name] ? 'set' : 'unset'}`}>
                {meta.configured[name] ? '✓' : '○'} {name}
              </span>
            ))}
          </div>
        ) : null}

        <section className="card">
          <h2><span className="step">0</span> Check the saved connection</h2>
          <p className="muted">
            Tries the variables this deployment already has. Use it when the dashboard reports a
            Zoho error: it says which part is refused and, if the token was issued in another data
            centre, which one. Secrets are never shown — only lengths and prefixes.
          </p>
          <button type="button" onClick={diagnose} disabled={diagnosing}>
            {diagnosing ? 'Asking Zoho…' : 'Check the saved connection'}
          </button>

          {diagnosis ? (
            <div className={`alert ${diagnosis.ok ? 'good' : 'bad'}`}>
              <b>{diagnosis.message || diagnosis.error}</b>

              {diagnosis.fix ? (
                <div className="copybox block" style={{ marginTop: 10 }}>
                  <pre>{diagnosis.fix}</pre>
                  <button type="button" onClick={() => copy(diagnosis.fix, 'fix')}>
                    {copied === 'fix' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : null}

              {diagnosis.checklist ? (
                <ul className="checklist">
                  {diagnosis.checklist.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}

              {diagnosis.notes && diagnosis.notes.length ? (
                <ul className="checklist">
                  {diagnosis.notes.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}

              {diagnosis.shape ? (
                <table className="shape">
                  <tbody>
                    {[
                      ['ZOHO_CLIENT_ID', diagnosis.shape.clientId],
                      ['ZOHO_CLIENT_SECRET', diagnosis.shape.clientSecret],
                      ['ZOHO_REFRESH_TOKEN', diagnosis.shape.refreshToken]
                    ].map(([name, info]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          {info && info.set
                            ? `${info.length} chars · ${info.prefix}…${info.suffix}${info.hadWhitespace ? ' · has stray whitespace' : ''}`
                            : 'not set'}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>ZOHO_ACCOUNTS_HOST</td>
                      <td>{diagnosis.shape.accountsHost}</td>
                    </tr>
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card">
          <h2><span className="step">1</span> Create the Self Client</h2>

          <div className="field inline">
            <label htmlFor="dc">Data centre your CRM lives in</label>
            <select id="dc" value={dc} onChange={(event) => setDc(event.target.value)}>
              {centres.length === 0 ? <option value="eu">Europe (.eu)</option> : null}
              {centres.map((centre) => (
                <option key={centre.key} value={centre.key}>{centre.label}</option>
              ))}
            </select>
          </div>

          <ol>
            <li>
              Open{' '}
              <a href={chosen ? chosen.console : 'https://api-console.zoho.eu'} target="_blank" rel="noreferrer">
                {chosen ? chosen.console : 'https://api-console.zoho.eu'}
              </a>{' '}
              signed in as a user who can see <b>every</b> deal. The refresh token inherits that
              user's visibility, so a restricted profile quietly returns fewer clients rather than
              an error.
            </li>
            <li><b>Add Client → Self Client → Create.</b> The <i>Client Secret</i> tab holds the two values you need below.</li>
            <li>
              Go to the <b>Generate Code</b> tab and paste this in the Scope box — one line, comma
              separated, no spaces. One scope per line is read as a single malformed scope and comes
              back as <code>invalid scope</code>:
              <div className="copybox">
                <code>{scopeString}</code>
                <button type="button" onClick={() => copy(scopeString, 'scope')}>
                  {copied === 'scope' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </li>
            <li>Time duration <b>10 minutes</b>, any description → <b>Create</b> → pick the CRM portal → <b>Create</b>. Copy the code: it works once and expires in minutes.</li>
          </ol>
        </section>

        <section className="card">
          <h2><span className="step">2</span> Exchange the code</h2>
          <form onSubmit={exchange}>
            <div className="grid">
              <div className="field">
                <label htmlFor="clientId">Client ID</label>
                <input
                  id="clientId"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value.trim())}
                  placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                />
              </div>
              <div className="field">
                <label htmlFor="clientSecret">Client Secret</label>
                <input
                  id="clientSecret"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value.trim())}
                />
              </div>
              <div className="field wide">
                <label htmlFor="code">Grant code</label>
                <input
                  id="code"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value.trim())}
                  placeholder="1000.xxxxxxxx.xxxxxxxx"
                />
              </div>
            </div>
            <button className="primary inline-btn" type="submit" disabled={busy}>
              {busy ? 'Asking Zoho…' : 'Get the refresh token'}
            </button>
          </form>

          {error ? (
            <div className="alert bad">
              <b>{error.error}</b>
              {error.hint ? <p>{error.hint}</p> : null}
            </div>
          ) : null}
        </section>

        {result ? (
          <>
            <section className="card">
              <h2><span className="step">3</span> Copy into Vercel</h2>
              <p className="muted">
                Project → Settings → Environment Variables. Tick Production, Preview and Development,
                then redeploy.
              </p>
              <div className="copybox block">
                <pre>{envBlock}</pre>
                <button type="button" onClick={() => copy(envBlock, 'env')}>
                  {copied === 'env' ? 'Copied' : 'Copy all'}
                </button>
              </div>
              <p className="muted">
                Scopes granted: <code>{result.scope}</code>. The refresh token does not expire unless
                it is revoked — but Zoho keeps at most 20 per client and user and silently drops the
                oldest, so keep this one rather than regenerating for a retry.
              </p>
            </section>

            <section className="card">
              <h2><span className="step">4</span> Check it before you save</h2>
              <p className="muted">
                Runs the same queries the dashboard runs, with these credentials, so you find out now
                whether this user sees the whole book.
              </p>
              <button type="button" onClick={runTest} disabled={testing}>
                {testing ? 'Checking…' : 'Test the connection'}
              </button>

              {testResult ? (
                testResult.error ? (
                  <div className="alert bad"><b>{testResult.error}</b></div>
                ) : (
                  <ul className="checks">
                    {testResult.checks.map((check) => (
                      <li key={check.name} className={check.ok ? 'ok' : 'bad'}>
                        <b>{check.ok ? '✓' : '✕'} {check.name}</b>
                        <span>{check.detail}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </section>
          </>
        ) : null}

        <p className="foot">
          <a className="domain" href="/">← Back to the dashboard</a>
        </p>
      </main>
    </>
  );
}
