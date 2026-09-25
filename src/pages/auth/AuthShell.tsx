import type { ReactNode } from "react";
import { CarFront } from "lucide-react";
import { Link } from "react-router-dom";
import { authStyles } from "./authStyles";

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthShell({ eyebrow, title, subtitle, children }: AuthShellProps) {
  return (
    <section className="rt-auth" aria-labelledby="rt-auth-title">
      <style>{authStyles}</style>
      <div className="rt-auth__card">
        <header className="rt-auth__head">
          <Link className="rt-auth__brand" to="/login">
            <span className="rt-auth__brand-mark" aria-hidden="true">
              <CarFront size={20} />
            </span>
            RideTogether
          </Link>
          <h1 className="rt-auth__title" id="rt-auth-title">
            {title}
          </h1>
          <p className="rt-auth__subtitle">
            <span className="rt-auth__eyebrow">{eyebrow}</span> {subtitle}
          </p>
        </header>
        <div className="rt-auth__body">{children}</div>
      </div>
    </section>
  );
}
