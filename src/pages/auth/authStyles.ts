export const authStyles = `
.rt-auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 30px 18px 44px;
  color: var(--rt-text, #17231c);
  background:
    radial-gradient(circle at 16% 6%, rgba(185, 235, 202, .55), transparent 30%),
    radial-gradient(circle at 86% 92%, rgba(160, 226, 186, .42), transparent 32%),
    linear-gradient(150deg, #f7fbf8, #edf8f0);
}
.rt-auth__card {
  width: min(460px, 100%);
  overflow: hidden;
  border: 1px solid #d5e6da;
  border-radius: 26px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 26px 66px rgba(24, 77, 43, .13);
}
.rt-auth__head {
  position: relative;
  overflow: hidden;
  padding: 26px 26px 22px;
  background: linear-gradient(135deg, #159447, #0c6c32);
  color: #fff;
}
.rt-auth__head::after {
  content: "";
  position: absolute;
  width: 220px;
  height: 220px;
  right: -96px;
  top: -128px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .1);
  pointer-events: none;
}
.rt-auth__brand {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  text-decoration: none;
  font-size: .8rem;
  font-weight: 850;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.rt-auth__brand-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, .18);
  border: 1px solid rgba(255, 255, 255, .26);
}
.rt-auth__title {
  position: relative;
  z-index: 1;
  margin: 18px 0 6px;
  font-size: clamp(1.5rem, 5vw, 1.85rem);
  letter-spacing: -.035em;
  line-height: 1.15;
}
.rt-auth__eyebrow {
  display: inline-block;
  margin-bottom: 5px;
  color: rgba(255, 255, 255, .74);
  font-size: .68rem;
  font-weight: 850;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.rt-auth__subtitle {
  position: relative;
  z-index: 1;
  margin: 0;
  color: rgba(255, 255, 255, .86);
  font-size: .87rem;
  line-height: 1.55;
}
.rt-auth__body { padding: 24px 26px 26px; display: grid; gap: 16px; }
.rt-auth__field { display: grid; gap: 7px; }
.rt-auth__label { font-size: .8rem; font-weight: 750; color: #34473b; }
.rt-auth__label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.rt-auth__label-link { color: #12813c; font-size: .76rem; font-weight: 800; text-decoration: none; }
.rt-auth__label-link:hover { text-decoration: underline; }
.rt-auth__input {
  width: 100%;
  min-height: 46px;
  padding: 10px 13px;
  border: 1px solid #d8e3db;
  border-radius: 12px;
  color: var(--rt-text, #17231c);
  background: #fff;
  font: inherit;
  font-size: .9rem;
  outline: none;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.rt-auth__input:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21, 148, 71, .13); }
.rt-auth__input[aria-invalid="true"] { border-color: #dc4c4c; }
.rt-auth__hint { color: #78867d; font-size: .74rem; line-height: 1.45; }
.rt-auth__error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: #bd3434;
  font-size: .76rem;
  line-height: 1.4;
}
.rt-auth__error svg { flex: 0 0 auto; margin-top: 1px; }
.rt-auth__notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 12px 13px;
  border: 1px solid #cfe6d6;
  border-radius: 12px;
  color: #166b3a;
  background: #effaf2;
  font-size: .81rem;
  line-height: 1.55;
}
.rt-auth__notice svg { flex: 0 0 auto; margin-top: 1px; color: #159447; }
.rt-auth__notice--error { border-color: #f0cccc; color: #b83434; background: #fdf1f1; }
.rt-auth__notice--error svg { color: #c23c3c; }
.rt-auth__submit {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  border: 0;
  border-radius: 13px;
  color: #fff;
  background: #159447;
  font: inherit;
  font-size: .9rem;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(21, 148, 71, .22);
  transition: background .18s ease, transform .18s ease, opacity .18s ease;
}
.rt-auth__submit:hover:not(:disabled) { background: #10813b; transform: translateY(-1px); }
.rt-auth__submit:disabled { opacity: .62; cursor: not-allowed; box-shadow: none; }
.rt-auth__divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 2px 0;
  color: #7b8880;
  font-size: .75rem;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.rt-auth__divider::before,
.rt-auth__divider::after { content: ""; flex: 1; height: 1px; background: #dfe7e1; }
.rt-auth__google {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  border: 1px solid #d5e0d8;
  border-radius: 13px;
  color: #26382d;
  background: #fff;
  font: inherit;
  font-size: .9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(21, 60, 38, .06);
  transition: background .18s ease, border-color .18s ease, opacity .18s ease;
}
.rt-auth__google:hover:not(:disabled) { background: #f5faf7; border-color: #159447; }
.rt-auth__google:disabled { opacity: .62; cursor: not-allowed; }
.rt-auth__foot {
  margin: 0;
  text-align: center;
  color: #6c7a71;
  font-size: .84rem;
}
.rt-auth__link { color: #12813c; font-weight: 800; text-decoration: none; }
.rt-auth__link:hover { text-decoration: underline; }
.rt-auth__legal { color: #7b8880; font-size: .73rem; line-height: 1.55; text-align: center; margin: 0; }
.rt-auth__avatar-field { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 12px; align-items: center; }
.rt-auth__avatar-preview {
  width: 60px;
  height: 60px;
  border-radius: 16px;
  object-fit: cover;
  background: #e2f4e7;
}
.rt-auth__avatar-fallback {
  display: grid;
  place-items: center;
  color: #15823f;
  font-size: 1.1rem;
  font-weight: 850;
}
.rt-auth__locked {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #74827a;
  font-size: .75rem;
  line-height: 1.45;
}
.rt-auth__locked svg { flex: 0 0 auto; color: #159447; }
.rt-auth__done { display: grid; gap: 14px; text-align: center; justify-items: center; }
.rt-auth__done-icon {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, #1aaa51, #0d7738);
  box-shadow: 0 14px 30px rgba(5, 70, 31, .22);
}
.rt-auth__done-title { margin: 0; font-size: 1.2rem; letter-spacing: -.02em; }
.rt-auth__done-copy { margin: 0; color: #63736a; font-size: .88rem; line-height: 1.6; }
[data-theme="dark"] .rt-auth {
  color: #eef7f1;
  background:
    radial-gradient(circle at 16% 6%, rgba(39, 102, 62, .42), transparent 30%),
    radial-gradient(circle at 86% 92%, rgba(30, 84, 51, .38), transparent 32%),
    linear-gradient(150deg, #0f1512, #14211a);
}
[data-theme="dark"] .rt-auth__card { border-color: #2b3a30; background: rgba(23, 33, 26, .96); box-shadow: 0 26px 66px rgba(0, 0, 0, .35); }
[data-theme="dark"] .rt-auth__label { color: #eef7f1; }
[data-theme="dark"] .rt-auth__label-link { color: #8be0a6; }
[data-theme="dark"] .rt-auth__input { color: #eef7f1; background: #1b271f; border-color: #34463a; }
[data-theme="dark"] .rt-auth__hint,
[data-theme="dark"] .rt-auth__locked,
[data-theme="dark"] .rt-auth__legal { color: #9daba2; }
[data-theme="dark"] .rt-auth__foot, [data-theme="dark"] .rt-auth__done-copy { color: #a6b5ac; }
[data-theme="dark"] .rt-auth__notice { border-color: #2f4a38; color: #b6e6c7; background: #16261c; }
[data-theme="dark"] .rt-auth__notice--error { border-color: #4a2b2b; color: #ffb0b0; background: #241618; }
[data-theme="dark"] .rt-auth__error { color: #ffb0b0; }
[data-theme="dark"] .rt-auth__link { color: #8be0a6; }
[data-theme="dark"] .rt-auth__divider { color: #9daba2; }
[data-theme="dark"] .rt-auth__divider::before,
[data-theme="dark"] .rt-auth__divider::after { background: #2b3a30; }
[data-theme="dark"] .rt-auth__google { color: #eef7f1; background: #1b271f; border-color: #34463a; }
[data-theme="dark"] .rt-auth__google:hover:not(:disabled) { background: #21301f; border-color: #159447; }
@media (max-width: 520px) {
  .rt-auth { padding: 16px 12px 30px; }
  .rt-auth__card { border-radius: 22px; }
  .rt-auth__head { padding: 22px 20px 20px; }
  .rt-auth__body { padding: 20px; }
}
`;
