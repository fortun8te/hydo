// Turning whatever the user picked into something that can live in state.json.
//
// A phone photo is 12 megapixels and several megabytes. state.json is parsed
// and re-serialised on EVERY save, and saves happen constantly while a
// teammate is streaming, so an un-resized avatar would tax every future write
// for the life of the app. The picture is displayed at 22-72px; anything past
// 256 is invisible and permanent.
//
// Done in the renderer because that is where a canvas is. The store still
// validates the result, because a checked input is not a checked value.

export const AVATAR_PX = 256;
export const MAX_AVATAR_BYTES = 350_000;

/**
 * Read an image File and return a square, centre-cropped PNG data URI.
 *
 * Centre-crop rather than letterbox: an avatar is drawn in a circle, and
 * fitting a landscape photo inside one leaves two empty bands.
 */
export function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) {
      reject(new Error("not an image"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) throw new Error("empty image");
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_PX;
        canvas.height = AVATAR_PX;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        // Centre horizontally, but NOT vertically on a tall photo.
        //
        // A phone portrait is roughly 3:4, and its subject's head sits in the
        // upper third. Taking the middle square of one lands on the torso: fed
        // a real 960x1280 photo this produced an avatar of a black t-shirt with
        // the face clipped at the top edge — technically the picture, useless
        // at 32px in a sidebar.
        //
        // 18% down from the top is the standard portrait bias and it degrades
        // safely: on a square image the term is zero, and on a landscape one
        // the vertical axis is already the short side so there is nothing to
        // choose. Only tall images move.
        const overflowY = img.naturalHeight - side;
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          overflowY * 0.18,
          side,
          side,
          0,
          0,
          AVATAR_PX,
          AVATAR_PX
        );
        // PNG first for a clean result; fall back to progressively meaner JPEG
        // if a busy photo will not fit. Failing to save is worse than a
        // slightly soft picture at 32px.
        let out = canvas.toDataURL("image/png");
        for (const q of [0.85, 0.7, 0.55]) {
          if (out.length <= MAX_AVATAR_BYTES) break;
          out = canvas.toDataURL("image/jpeg", q);
        }
        if (out.length > MAX_AVATAR_BYTES) throw new Error("image too complex");
        resolve(out);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode"));
    };
    img.src = url;
  });
}

export function initialOfName(name) {
  const s = String(name || "").trim();
  return s ? s[0].toUpperCase() : "?";
}
