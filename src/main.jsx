import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./kit/tokens.css";
import "./kit/icons.css";
import "./styles.css";
import "./screens/production.css";
import "./screens/composer.css";
import "./screens/sidebar.css";
import "./screens/transcript.css";
import "./screens/choicecard.css";
import "./screens/rails.css";
import "./screens/overlays.css";
import "./screens/richcontent.css";
import "./screens/plugins.css";
import "./screens/palette.css";
import "./screens/settings.css";

document.documentElement.dataset.theme = "cursor-dark";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
