import { Capacitor } from "@capacitor/core";

// Verrouille l'écran en paysage (appli Android) ; sur le web, on essaie l'API du navigateur.
export async function lockLandscape() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "landscape" });
    } else if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (e) {
    /* pas supporté : on reste dans l'orientation actuelle */
  }
}

// Rend la main au téléphone (retour à l'orientation normale)
export async function unlockOrientation() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.unlock();
    } else if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (e) {
    /* rien */
  }
}
