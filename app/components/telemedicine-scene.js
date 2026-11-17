import Image from "next/image";
import { Icon } from "./icons.js";

/** Rendered consultation artwork with reduced-motion-aware decorative depth. */
export function TelemedicineScene({ lang }) {
  const bn = lang === "bn";
  return (
    <div className="tele-scene">
      <div className="tele-art-frame">
        <Image src="/images/consultation-hero.png"
          alt={bn ? "ঘরে বসে ল্যাপটপে চিকিৎসকের সঙ্গে পরামর্শ করছেন একজন তরুণী" : "A young woman at home consulting a doctor over a laptop video call"}
          width={1254} height={1254}
          sizes="(max-width: 760px) 100vw, (max-width: 1220px) 45vw, 540px" priority />
      </div>
      <div className="tele-note tele-book">
        <Icon name="video" size={22} />
        <div><strong>{bn ? "ঘরে বসেই পরামর্শ" : "Care, face to face"}</strong><span>{bn ? "আপনার চিকিৎসক, আপনার পাশে" : "Your doctor, wherever you are"}</span></div>
      </div>
      <div className="tele-note tele-rx" aria-hidden="true">
        <Icon name="heart" size={22} />
        <div className="tele-wave">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * .12}s` }} />)}</div>
      </div>
    </div>
  );
}
