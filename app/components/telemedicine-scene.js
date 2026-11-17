import { Icon } from "./icons.js";

/** Lightweight CSS 3D illustration; no camera or live call is started here. */
export function TelemedicineScene({ lang }) {
  const bn = lang === "bn";
  return (
    <div className="tele-scene" role="img" aria-label={bn ? "অনলাইনে চিকিৎসকের সঙ্গে ভিডিও পরামর্শের অ্যানিমেশন" : "Animated three-dimensional illustration of an online doctor consultation"}>
      <div className="tele-orbit" aria-hidden="true" />
      <div className="tele-device" aria-hidden="true">
        <div className="tele-device-top"><span /><span /><span /><i><Icon name="shield" size={16} /></i></div>
        <div className="tele-screen">
          <div className="tele-cross">+</div>
          <div className="tele-doctor">
            <div className="tele-hair" />
            <div className="tele-face"><i /><i /><span /></div>
            <div className="tele-neck" />
            <div className="tele-coat"><div className="tele-shirt" /><div className="tele-stethoscope" /><b>+</b></div>
          </div>
          <div className="tele-wave">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * .12}s` }} />)}</div>
        </div>
        <div className="tele-controls"><span><Icon name="video" size={19} /></span><span><Icon name="heart" size={19} /></span><span className="tele-end">×</span></div>
      </div>
      <div className="tele-note tele-book"><Icon name="calendar" size={24} /><div><strong>{bn ? "সহজে অ্যাপয়েন্টমেন্ট" : "Care on your schedule"}</strong><span>{bn ? "আপনার সময় বেছে নিন" : "Choose a time that suits you"}</span></div></div>
      <div className="tele-note tele-rx"><Icon name="file" size={24} /><div><strong>{bn ? "ডিজিটাল প্রেসক্রিপশন" : "Digital prescriptions"}</strong><span>{bn ? "পরামর্শের পরেই" : "After your consultation"}</span></div></div>
      <div className="tele-platform" aria-hidden="true" />
    </div>
  );
}
