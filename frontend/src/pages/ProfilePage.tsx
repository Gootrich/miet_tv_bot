import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";

export function ProfilePage({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <h1 className="section-title">Профиль</h1>

        <div className="card">
          <h2 className="card__title">MIET TV Equipment Bot</h2>
          <p className="card__subtitle">
            Режим разработчика / Telegram Mini App активен.
          </p>
        </div>

        <div className="card">
          <h2 className="card__title">Связь с разработчиком</h2>
          <p className="card__subtitle">
            По вопросам работы приложения — обратитесь к администратору студии.
          </p>
        </div>
      </main>
      <BottomNav active="profile" onSelect={onNavigate} />
    </div>
  );
}
