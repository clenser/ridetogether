export const chatPageStyles = `
.rt-chat-page { min-height: 100%; display: flex; flex-direction: column; padding: 24px 20px 40px; color: var(--rt-text); }

.rt-chat-shell { width: 100%; max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; min-height: 0; }

/* ---- list + detail split ---- */
.rt-chat-split { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 18px; align-items: start; min-height: 0; }
.rt-chat-rail { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

/* ---- conversation list ---- */
.rt-chat-conversations { display: flex; flex-direction: column; border: 1px solid var(--rt-border); border-radius: 20px; background: var(--rt-card); overflow: hidden; }
.rt-chat-conversations-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 16px; border-bottom: 1px solid var(--rt-surface-muted); }
.rt-chat-conversations-title { display: flex; align-items: center; gap: 7px; margin: 0; font-size: .82rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--rt-primary-strong); }
.rt-chat-conversations-list { display: flex; flex-direction: column; }
.rt-chat-conversation-item { display: flex; gap: 11px; padding: 13px 16px; border: 0; border-bottom: 1px solid var(--rt-surface-muted); text-align: left; text-decoration: none; color: inherit; background: transparent; cursor: pointer; transition: background .16s ease; }
.rt-chat-conversation-item:last-child { border-bottom: 0; }
.rt-chat-conversation-item:hover { background: var(--rt-surface-subtle); }
.rt-chat-conversation-item[aria-current="true"] { background: color-mix(in srgb, var(--rt-primary) 8%, transparent); box-shadow: inset 3px 0 0 var(--rt-primary); }
.rt-chat-conversation-avatar { display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-chat-conversation-copy { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; }
.rt-chat-conversation-route { font-size: .88rem; font-weight: 750; color: var(--rt-text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-chat-conversation-meta { display: flex; align-items: center; gap: 7px; font-size: .74rem; color: var(--rt-text-muted); }
.rt-chat-conversation-role { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: .68rem; font-weight: 700; background: var(--rt-surface-subtle); }
.rt-chat-conversation-role--driver { color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-chat-conversation-preview { font-size: .8rem; color: var(--rt-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-chat-conversation-time { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: 0 0 auto; font-size: .7rem; color: var(--rt-text-subtle); }
.rt-chat-unread { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; font-size: .64rem; font-weight: 800; color: var(--rt-on-primary); background: var(--rt-primary); }

/* ---- header ---- */
.rt-chat-details { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 14px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-text); background: var(--rt-card); font-size: .8rem; font-weight: 700; text-decoration: none; }
.rt-chat-details:hover { background: var(--rt-surface-subtle); }
.rt-chat-back { display: none; }

/* ---- shared journey header ---- */
.rt-chat-journey { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 16px 18px; border-bottom: 1px solid var(--rt-surface-muted); background: linear-gradient(135deg, var(--rt-surface-subtle), var(--rt-card)); }
.rt-chat-journey-copy { min-width: 0; flex: 1 1 260px; }
.rt-chat-journey-kicker { display: flex; align-items: center; gap: 6px; color: var(--rt-primary-strong); font-size: .68rem; font-weight: 800; letter-spacing: .045em; text-transform: uppercase; }
/* min-width: 0 plus wrapping is what stops a long place name from widening the
   panel and pushing the meta column off screen. */
.rt-chat-journey-title { margin: 4px 0 0; font-size: 1.02rem; font-weight: 800; line-height: 1.3; color: var(--rt-text-strong); overflow-wrap: anywhere; }
.rt-chat-journey-title span { color: var(--rt-text-subtle); }
.rt-chat-journey-meta { display: flex; flex-direction: column; gap: 5px; flex: 0 1 auto; min-width: 0; font-size: .76rem; color: var(--rt-text-muted); }
.rt-chat-journey-meta span { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.rt-chat-journey-meta svg { flex: 0 0 auto; }

/* ---- states ---- */
.rt-chat-state { display: grid; place-items: center; min-height: 380px; padding: 30px; text-align: center; border: 1px solid var(--rt-border); border-radius: 22px; background: var(--rt-card); }
.rt-chat-state-inner { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 420px; }
.rt-chat-state-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-chat-state h2 { margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--rt-text-strong); }
.rt-chat-state p { margin: 0; font-size: .87rem; line-height: 1.55; color: var(--rt-text-muted); }

/* ---- conversation ---- */
.rt-chat-panel { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: min(74vh, 760px); border: 1px solid var(--rt-border); border-radius: 22px; background: var(--rt-card); box-shadow: 0 14px 38px color-mix(in srgb, var(--rt-primary) 7%, transparent); overflow: hidden; }
.rt-chat-thread { display: flex; flex-direction: column; gap: 4px; min-height: 0; padding: 16px 14px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.rt-chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; height: 100%; padding: 24px; text-align: center; }
.rt-chat-empty-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 18px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-chat-empty h3 { margin: 0; font-size: .98rem; font-weight: 800; color: var(--rt-text-strong); }
.rt-chat-empty p { margin: 0; max-width: 340px; font-size: .85rem; line-height: 1.55; color: var(--rt-text-muted); }
.rt-chat-day { align-self: center; margin: 12px 0 8px; padding: 3px 11px; border-radius: 999px; font-size: .7rem; font-weight: 700; color: var(--rt-text-muted); background: var(--rt-surface-subtle); }
.rt-chat-group { display: flex; gap: 10px; align-items: flex-end; max-width: 84%; }
.rt-chat-group--own { align-self: flex-end; flex-direction: row-reverse; }
.rt-chat-avatar { display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px; border-radius: 10px; color: var(--rt-text-muted); background: var(--rt-surface-subtle); font-size: .68rem; font-weight: 800; overflow: hidden; }
.rt-chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
.rt-chat-group-content { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rt-chat-group--own .rt-chat-group-content { align-items: flex-end; }
.rt-chat-sender { display: flex; align-items: baseline; gap: 6px; padding-inline: 4px; font-size: .72rem; color: var(--rt-text-muted); }
.rt-chat-sender strong { font-weight: 750; color: var(--rt-text); }
.rt-chat-bubble { display: flex; flex-direction: column; gap: 3px; padding: 9px 13px; border-radius: 16px 16px 16px 5px; color: var(--rt-text); background: var(--rt-surface-subtle); }
.rt-chat-bubble.rt-chat-consecutive { border-radius: 16px 16px 5px 5px; }
.rt-chat-group--own .rt-chat-bubble { border-radius: 16px 16px 5px 16px; color: var(--rt-on-primary); background: var(--rt-primary); }
.rt-chat-group--own .rt-chat-bubble.rt-chat-consecutive { border-radius: 16px 5px 5px 16px; }
/* overflow-wrap matters here: a long URL or a run of letters is the most common
   real message, and it is what turns a bubble into a horizontal scrollbar. */
.rt-chat-message { font-size: .89rem; line-height: 1.5; overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.rt-chat-time { font-size: .66rem; color: var(--rt-text-subtle); }
.rt-chat-group--own .rt-chat-time { color: color-mix(in srgb, var(--rt-on-primary) 72%, transparent); }

/* ---- composer ---- */
.rt-chat-composer { border-top: 1px solid var(--rt-surface-muted); background: var(--rt-card); }
.rt-chat-composer-inner { display: flex; flex-direction: column; gap: 6px; padding: 11px 13px; }
.rt-chat-privacy { display: flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--rt-text-muted); }
.rt-chat-privacy svg { flex: 0 0 auto; }
.rt-chat-form { display: flex; flex-direction: column; gap: 7px; }
.rt-chat-input-row { display: flex; align-items: flex-end; gap: 8px; }
.rt-chat-field { position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; border: 1px solid var(--rt-border); border-radius: 14px; background: var(--rt-surface-subtle); transition: border-color .16s ease, box-shadow .16s ease; }
.rt-chat-field:focus-within { border-color: var(--rt-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 18%, transparent); }
.rt-chat-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.rt-chat-textarea { width: 100%; max-height: 132px; min-height: 42px; padding: 10px 12px; border: 0; border-radius: 14px; resize: none; color: var(--rt-text); background: transparent; font: inherit; font-size: .9rem; line-height: 1.45; }
.rt-chat-textarea:focus { outline: none; }
.rt-chat-count { position: absolute; right: 10px; bottom: 6px; padding: 1px 5px; border-radius: 6px; font-size: .66rem; color: var(--rt-text-subtle); background: var(--rt-surface-subtle); pointer-events: none; }
.rt-chat-textarea:not(:placeholder-shown) ~ .rt-chat-count { opacity: 0; }
.rt-chat-send { display: grid; place-items: center; flex: 0 0 auto; width: 44px; height: 44px; border: 0; border-radius: 14px; color: var(--rt-on-primary); background: var(--rt-primary); cursor: pointer; transition: background .16s ease, opacity .16s ease; }
.rt-chat-send:hover:not(:disabled) { background: var(--rt-primary-strong); }
.rt-chat-send:disabled { opacity: .45; cursor: not-allowed; }
.rt-chat-spin { animation: rt-chat-spin 1s linear infinite; }
@keyframes rt-chat-spin { to { transform: rotate(360deg); } }
.rt-chat-error { display: flex; align-items: center; gap: 6px; margin: 0; padding: 7px 11px; border-radius: 10px; font-size: .78rem; color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-chat-hint { margin: 0; }
.rt-chat-readonly { display: flex; align-items: flex-start; gap: 9px; padding: 12px 13px; font-size: .8rem; color: var(--rt-text-muted); }
.rt-chat-readonly svg { flex: 0 0 auto; margin-top: 2px; }
.rt-chat-readonly span { display: flex; flex-direction: column; gap: 2px; }
.rt-chat-readonly strong { color: var(--rt-text-strong); }

@media (max-width: 900px) {
  /* One pane at a time on a phone: the bare /chat route is the list, and a
     chosen ride replaces it with the conversation plus a back control to the
     list. The rail is hidden rather than reflowed, so a conversation never
     shares a small screen with a list it does not need. */
  .rt-chat-split { grid-template-columns: minmax(0, 1fr); }
  .rt-chat-rail { display: none; }
  .rt-chat-back { display: inline-flex; }
  .rt-chat-panel { height: calc(100dvh - var(--rt-safe-top) - var(--rt-mobile-nav-inset) - 132px); min-height: 420px; }
  .rt-chat-thread { padding: 14px 11px; }
  .rt-chat-group { max-width: 90%; }
  .rt-chat-journey { padding: 14px; }
  .rt-chat-journey-title { font-size: .95rem; }
  .rt-chat-privacy--composer { display: none; }
}

@media (max-width: 420px) {
  .rt-chat-composer-inner { padding: 10px; }
  .rt-chat-count { display: none; }
}
`;
