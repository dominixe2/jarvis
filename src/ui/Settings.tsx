import { useEffect, useState, type FormEvent } from 'react'

type KeyStatus = { configured: boolean; secureStorage: boolean; storage: string; backend: 'bridge' | 'gemini' }

const API = 'http://127.0.0.1:8788/api/gemini'

export function Settings() {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showKey, setShowKey] = useState(false)

  async function refreshStatus() {
    try {
      const response = await fetch(`${API}/status`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Status se nepodařilo načíst.')
      setStatus(data)
      setMessage('')
    } catch {
      setStatus(null)
      setMessage('Místní služba neběží. Restartuj JARVIS přes npm start.')
    }
  }

  useEffect(() => {
    if (open) void refreshStatus()
  }, [open])

  async function chooseBackend(backend: 'bridge' | 'gemini') {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('http://127.0.0.1:8788/api/backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Režim se nepodařilo uložit.')
      setStatus((current) => current ? { ...current, backend: data.backend } : current)
      setMessage('Režim je uložen. Restartuj JARVIS přes npm start, aby se změna projevila.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Režim se nepodařilo uložit.')
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!key.trim()) {
      setMessage('Nejdřív vlož API klíč.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`${API}/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Uložení selhalo.')
      setKey('')
      setStatus(data)
      setMessage('Klíč je uložen šifrovaně pro tvůj účet Windows.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Klíč se nepodařilo uložit.')
    } finally {
      setBusy(false)
    }
  }

  async function removeKey() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`${API}/key`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Odebrání selhalo.')
      setStatus(data)
      setMessage('Uložený klíč byl odebrán.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Klíč se nepodařilo odebrat.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 22, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, pointerEvents: 'none', fontFamily: 'system-ui, sans-serif', color: '#baf8ff' }}>
      {open && (
        <section aria-label="Nastavení JARVIS" style={{ pointerEvents: 'auto', width: 'min(360px, calc(100vw - 32px))', padding: 18, border: '1px solid #00e5ff66', borderRadius: 12, background: 'rgba(1, 9, 16, 0.97)', boxShadow: '0 0 35px #00e5ff20' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16, letterSpacing: '0.12em', fontWeight: 600 }}>JARVIS / NASTAVENÍ</h2>
          <p style={{ margin: '0 0 14px', fontSize: 12, lineHeight: 1.5, color: '#94bfc8' }}>Gemini API klíč se ukládá šifrovaně pomocí ochrany Windows DPAPI. Klíč se neposílá do klientského JavaScriptu.</p>
          <label htmlFor="jarvis-backend" style={{ display: 'block', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em' }}>REŽIM ASISTENTA</label>
          <select
            id="jarvis-backend"
            value={status?.backend ?? 'bridge'}
            disabled={busy || !status}
            onChange={(event) => void chooseBackend(event.target.value as 'bridge' | 'gemini')}
            style={{ width: '100%', border: '1px solid #00e5ff55', borderRadius: 6, padding: '10px 9px', marginBottom: 12, background: '#06131b', color: '#d9fbff' }}
          >
            <option value="bridge">Lokální bridge (Claude Code + nástroje)</option>
            <option value="gemini">Gemini Flash (konverzace, bez PC nástrojů)</option>
          </select>
          {status?.backend === 'gemini' && <p style={{ margin: '-4px 0 12px', fontSize: 11, lineHeight: 1.5, color: '#ffc477' }}>Gemini režim zatím zajišťuje konverzaci. Pro lokální ovládání počítače přepni na bridge; ten vyžaduje funkční přihlášení Claude Code.</p>}
          <div style={{ fontSize: 12, marginBottom: 12 }}>
            <strong>Stav: </strong>
            {status ? (status.configured ? 'API klíč nastaven' : 'API klíč chybí') : 'kontroluji místní službu…'}
            {status && <div style={{ color: status.secureStorage ? '#6fffc0' : '#ffc477', marginTop: 4 }}>Uložení: {status.storage}</div>}
          </div>
          <form onSubmit={save}>
            <label htmlFor="jarvis-gemini-key" style={{ display: 'block', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em' }}>GEMINI API KEY</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="jarvis-gemini-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Vlož svůj klíč…"
                style={{ minWidth: 0, flex: 1, border: '1px solid #00e5ff55', borderRadius: 6, padding: '10px 9px', background: '#06131b', color: '#d9fbff' }}
              />
              <button type="button" onClick={() => setShowKey((value) => !value)} style={{ border: '1px solid #00e5ff55', borderRadius: 6, padding: '0 9px', background: '#06131b', color: '#9ceef5', cursor: 'pointer' }}>{showKey ? 'Skrýt' : 'Zobrazit'}</button>
            </div>
            <button type="submit" disabled={busy} style={{ marginTop: 10, width: '100%', border: 0, borderRadius: 6, padding: 11, background: busy ? '#27505a' : '#00d9ee', color: '#001016', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'PRACUJI…' : 'BEZPEČNĚ ULOŽIT KLÍČ'}</button>
          </form>
          {status?.configured && <button type="button" disabled={busy} onClick={() => void removeKey()} style={{ marginTop: 8, width: '100%', border: '1px solid #ff8d8d66', borderRadius: 6, padding: 9, background: 'transparent', color: '#ffaaaa', cursor: busy ? 'wait' : 'pointer' }}>ODEBRAT ULOŽENÝ KLÍČ</button>}
          {message && <p role="status" style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: message.includes('šifrovaně') || message.includes('odebrán') ? '#6fffc0' : '#ffc477' }}>{message}</p>}
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{ pointerEvents: 'auto', border: '1px solid #00e5ff88', borderRadius: 8, background: '#04121beF', color: '#8ff5ff', padding: '10px 14px', cursor: 'pointer', letterSpacing: '0.08em' }}
      >
        {open ? 'ZAVŘÍT NASTAVENÍ' : '⚙ NASTAVENÍ'}
      </button>
    </div>
  )
}
