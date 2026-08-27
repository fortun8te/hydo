import { APP_ICON } from "../lib/blobs.js";

export default function SignIn({ onSignIn }) {
  return (
    <div className="gate">
      <div className="gate__chrome" />
      <div className="gate__stack">
        <img className="gate__blob" src={APP_ICON} alt="" width="88" height="88" />
        <h1 className="gate__title">Hydo Bot</h1>
        <p className="gate__tagline">Your team of always-on Bots that you can give real work to.</p>
        <button className="gate__btn" type="button" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}
