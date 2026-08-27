import { lazy, Suspense, useEffect, useState } from "react";
import SignIn from "./screens/SignIn.jsx";
import Shell from "./screens/Shell.jsx";

// `?lab=1` opens the face bench instead of the app. Lazy so the controls and
// the contact sheet are not in the shipped chunk for everyone else.
const FaceLab = lazy(() => import("./screens/FaceLab.jsx"));

function wantsLab() {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("lab");
}

// A thin router so the lab branch is taken BEFORE any hook runs. Putting the
// `?lab=1` check inside App() with the hooks below it is a conditional hook
// call, which React 19 will not forgive the first time the branch flips.
export default function App() {
  if (wantsLab()) {
    return (
      <Suspense fallback={<div className="boot" />}>
        <FaceLab />
      </Suspense>
    );
  }
  return <HydoApp />;
}

function HydoApp() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // Opt-in only (`?mock=1`). Electron always has the real preload, and a
      // plain browser tab must never invent a roster of bots you didn't make.
      const wantsMock =
        typeof location !== "undefined" && new URLSearchParams(location.search).has("mock");
      if (!window.hydo && wantsMock && import.meta.env.DEV) {
        const { installDevMock } = await import("./lib/devmock.js");
        installDevMock();
      }
      if (!window.hydo) {
        setState({
          signedIn: false,
          selectedId: null,
          agents: [],
          messages: {},
          settings: { appearance: "dark", userName: "Michael" },
        });
        return;
      }
      setState(await window.hydo.getState());
      unsub = window.hydo.onState(setState);
    })();
    return () => unsub();
  }, []);

  if (!state) {
    return <div className="boot" />;
  }
  if (!state.signedIn) {
    return <SignIn onSignIn={() => window.hydo.signIn()} />;
  }
  return <Shell state={state} />;
}
