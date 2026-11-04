// Empreinte digitale : elle déverrouille l'appli à la place du code PIN (le PIN reste le recours).
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { isNative } from "./api";

const KEY = "pcr_bio";

export const bioOn = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch (e) {
    return false;
  }
};

export const setBioOn = (on) => {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch (e) {}
};

// Le téléphone a-t-il un capteur d'empreinte (ou de visage) configuré ?
export async function bioAvailable() {
  if (!isNative()) return false;
  try {
    const r = await NativeBiometric.isAvailable();
    return Boolean(r && r.isAvailable);
  } catch (e) {
    return false;
  }
}

// Ouvre la fenêtre d'empreinte du téléphone. true si c'est bon.
export async function bioAsk() {
  try {
    await NativeBiometric.verifyIdentity({
      reason: "Déverrouiller WakeUp-Pc",
      title: "WakeUp-Pc",
      subtitle: "Pose ton doigt sur le capteur",
      negativeButtonText: "Utiliser le code",
    });
    return true;
  } catch (e) {
    return false;
  }
}
