/** Вход через существующий Supabase Auth: регистрация закрыта, аккаунты заводит администратор. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../api";

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (authError) {
      setError("Не удалось войти. Проверьте адрес и пароль.");
      return;
    }
    onDone();
    navigate("/");
  };

  return (
    <section>
      <h1>Вход</h1>
      <p className="sub">Аккаунты заводит администратор; самостоятельная регистрация закрыта.</p>
      <form className="form" onSubmit={submit}>
        <label>
          Почта
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>{busy ? "Проверяем…" : "Войти"}</button>
        </div>
      </form>
    </section>
  );
}
