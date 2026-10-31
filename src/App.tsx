export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Desk</p>
          <h1>Proofreader</h1>
        </div>
        <nav aria-label="Main navigation">
          <button type="button">Today</button>
          <button type="button">Drawers</button>
          <button type="button">Patterns</button>
          <button type="button">Desk</button>
        </nav>
      </header>

      <section className="session-panel" aria-label="Session workspace">
        <div className="progress-line" aria-hidden="true" />
        <div className="session-card">
          <p className="eyebrow">Session</p>
          <h2>Start a 6 minute proof session</h2>
          <p>
            One word at a time. See it, hide it, recall it, check the pattern, and schedule the
            next review.
          </p>
          <button type="button" className="primary-action">
            Start session
          </button>
        </div>
      </section>
    </main>
  );
}
