import { initializeRouter, navigate } from "./navigation/index.js";

window.app = {
  navigate,
};

document.addEventListener("DOMContentLoaded", () => {
  initializeRouter();
});
