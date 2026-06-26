import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./content.css";

type Adjustments = {
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
};

type ImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const defaultAdjustments: Adjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
};

type Profile = "camera-natural" | "camera-vivid" | "portrait" | "landscape";

const profileLabels: Record<Profile, string> = {
  "camera-natural": "カメラ ナチュラル",
  "camera-vivid": "カメラ ビビッド",
  portrait: "ポートレート",
  landscape: "風景",
};

export default defineContentScript({
  matches: ["https://drive.google.com/*"],
  main() {
    const existingRoot = document.getElementById("drive-retouch-root");
    if (existingRoot) return;

    const root = document.createElement("div");
    root.id = "drive-retouch-root";
    document.documentElement.appendChild(root);

    createRoot(root).render(<RetouchApp />);
  },
});

function findLargestVisibleImage(): HTMLImageElement | null {
  const images = Array.from(document.images);

  const visibleImages = images
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;

      return {
        img,
        rect,
        area,
      };
    })
    .filter(({ img, rect, area }) => {
      const style = window.getComputedStyle(img);

      return (
        area > 50_000 &&
        rect.width > 200 &&
        rect.height > 200 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        img.currentSrc
      );
    })
    .sort((a, b) => b.area - a.area);

  return visibleImages[0]?.img ?? null;
}

function getImageRect(img: HTMLImageElement): ImageRect {
  const rect = img.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function buildFilter(
  a: Adjustments,
  profile: Profile,
  monochrome: boolean,
  hdr: boolean,
): string {
  const profileBoost =
    profile === "camera-vivid"
      ? { brightness: 1.01, contrast: 1.08, saturation: 1.14 }
      : profile === "portrait"
        ? { brightness: 1.03, contrast: 0.96, saturation: 1.04 }
        : profile === "landscape"
          ? { brightness: 1, contrast: 1.1, saturation: 1.16 }
          : { brightness: 1, contrast: 1, saturation: 1 };

  // CSS filterでの非破壊プレビューなので、Lightroom相当の各補正は近似する。
  const brightness =
    profileBoost.brightness *
    (1 +
      a.exposure / 120 +
      a.shadows / 450 +
      a.whites / 650 -
      a.blacks / 650 -
      Math.max(a.highlights, 0) / 900 +
      (hdr ? 0.03 : 0));
  const contrast =
    profileBoost.contrast *
    (1 +
      a.contrast / 140 +
      a.clarity / 260 +
      a.texture / 360 +
      a.dehaze / 260 +
      (hdr ? 0.12 : 0));
  const saturation =
    profileBoost.saturation *
    (1 + a.saturation / 120 + a.vibrance / 180 + (hdr ? 0.05 : 0));
  const sepia = Math.max(a.temperature, 0) / 180;
  const hueRotate = a.tint * 0.18 + Math.min(a.temperature, 0) * 0.08;

  return [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
    `sepia(${sepia})`,
    `hue-rotate(${hueRotate}deg)`,
    `grayscale(${monochrome ? 1 : 0})`,
  ].join(" ");
}

function RetouchApp() {
  const [targetImage, setTargetImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [beforeAfter, setBeforeAfter] = useState(100);
  const [profile, setProfile] = useState<Profile>("camera-natural");
  const [monochrome, setMonochrome] = useState(false);
  const [hdr, setHdr] = useState(false);
  const [adjustments, setAdjustments] =
    useState<Adjustments>(defaultAdjustments);

  const filter = useMemo(
    () => buildFilter(adjustments, profile, monochrome, hdr),
    [adjustments, hdr, monochrome, profile],
  );

  useEffect(() => {
    const updateTargetImage = () => {
      const img = findLargestVisibleImage();

      setTargetImage(img);
      setImageSrc(img?.currentSrc ?? null);
      setImageRect(img ? getImageRect(img) : null);
    };

    updateTargetImage();

    const observer = new MutationObserver(updateTargetImage);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "class"],
    });

    window.addEventListener("resize", updateTargetImage);
    window.addEventListener("scroll", updateTargetImage, true);

    const intervalId = window.setInterval(updateTargetImage, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateTargetImage);
      window.removeEventListener("scroll", updateTargetImage, true);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!targetImage) return;

    // Google Drive側の元画像は加工しない。
    // Beforeとして残して、その上にAfter画像を重ねる。
    targetImage.style.filter = "";

    return () => {
      targetImage.style.filter = "";
    };
  }, [targetImage]);

  const updateAdjustment = (key: keyof Adjustments, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  if (!imageSrc || !imageRect) {
    return null;
  }

  return (
    <>
      {!panelOpen && (
        <button
          className="dr-floating-button"
          onClick={() => setPanelOpen(true)}
        >
          レタッチ
        </button>
      )}

      {panelOpen && (
        <>
          <div
            className="dr-after-layer"
            style={{
              left: imageRect.left,
              top: imageRect.top,
              width: imageRect.width,
              height: imageRect.height,
            }}
          >
            <div
              className="dr-after-clip"
              style={{
                width: `${beforeAfter}%`,
              }}
            >
              <img
                className="dr-after-image"
                src={imageSrc}
                style={{
                  width: imageRect.width,
                  height: imageRect.height,
                  filter,
                }}
              />
            </div>

            <div
              className="dr-before-after-line"
              style={{
                left: `${beforeAfter}%`,
              }}
            />
          </div>

          <aside className="dr-control-panel">
            <header className="dr-panel-header">
              <div>
                <div className="dr-title">Drive Retouch</div>
                <div className="dr-subtitle">プレビューのみ / 保存されません</div>
              </div>

              <button
                className="dr-close"
                onClick={() => {
                  setPanelOpen(false);
                  setAdjustments(defaultAdjustments);
                  setBeforeAfter(100);
                  setProfile("camera-natural");
                  setMonochrome(false);
                  setHdr(false);
                }}
              >
                ×
              </button>
            </header>

            <div className="dr-quick-actions">
              <button
                onClick={() =>
                  setAdjustments({
                    ...defaultAdjustments,
                    exposure: 8,
                    contrast: 10,
                    highlights: -18,
                    shadows: 24,
                    whites: 8,
                    blacks: -8,
                    vibrance: 12,
                  })
                }
              >
                自動補正
              </button>
              <button
                className={monochrome ? "dr-active" : undefined}
                onClick={() => setMonochrome((value) => !value)}
              >
                白黒
              </button>
              <button
                className={hdr ? "dr-active" : undefined}
                onClick={() => setHdr((value) => !value)}
              >
                HDR
              </button>
            </div>

            <label className="dr-select-row">
              <span>プロファイル</span>
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as Profile)}
              >
                {Object.entries(profileLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="dr-divider-horizontal" />

            <div className="dr-section-title">WB: 撮影時</div>
            <Slider
              label="色温度"
              min={-100}
              max={100}
              value={adjustments.temperature}
              formatValue={(value) => `${Math.round(5_250 + value * 35)}`}
              onChange={(v) => updateAdjustment("temperature", v)}
            />

            <Slider
              label="色かぶり補正"
              min={-100}
              max={100}
              value={adjustments.tint}
              formatValue={(value) => (value > 0 ? `+${value}` : `${value}`)}
              onChange={(v) => updateAdjustment("tint", v)}
            />

            <div className="dr-divider-horizontal" />
            <div className="dr-section-title">階調</div>
            <Slider
              label="比較"
              min={0}
              max={100}
              value={beforeAfter}
              formatValue={(value) => `${value}%`}
              onChange={setBeforeAfter}
            />

            <div className="dr-divider-horizontal" />

            <Slider
              label="露光量"
              min={-100}
              max={100}
              value={adjustments.exposure}
              formatValue={(value) => (value / 100).toFixed(2)}
              onChange={(v) => updateAdjustment("exposure", v)}
            />

            <Slider
              label="コントラスト"
              min={-100}
              max={100}
              value={adjustments.contrast}
              onChange={(v) => updateAdjustment("contrast", v)}
            />

            <Slider
              label="ハイライト"
              min={-100}
              max={100}
              value={adjustments.highlights}
              onChange={(v) => updateAdjustment("highlights", v)}
            />

            <Slider
              label="シャドウ"
              min={-100}
              max={100}
              value={adjustments.shadows}
              onChange={(v) => updateAdjustment("shadows", v)}
            />

            <Slider
              label="白レベル"
              min={-100}
              max={100}
              value={adjustments.whites}
              onChange={(v) => updateAdjustment("whites", v)}
            />

            <Slider
              label="黒レベル"
              min={-100}
              max={100}
              value={adjustments.blacks}
              onChange={(v) => updateAdjustment("blacks", v)}
            />

            <div className="dr-divider-horizontal" />
            <div className="dr-section-title">外観</div>
            <Slider
              label="テクスチャ"
              min={-100}
              max={100}
              value={adjustments.texture}
              onChange={(v) => updateAdjustment("texture", v)}
            />

            <Slider
              label="明瞭度"
              min={-100}
              max={100}
              value={adjustments.clarity}
              onChange={(v) => updateAdjustment("clarity", v)}
            />

            <Slider
              label="かすみの除去"
              min={-100}
              max={100}
              value={adjustments.dehaze}
              onChange={(v) => updateAdjustment("dehaze", v)}
            />

            <div className="dr-divider-horizontal" />
            <Slider
              label="自然な彩度"
              min={-100}
              max={100}
              value={adjustments.vibrance}
              onChange={(v) => updateAdjustment("vibrance", v)}
            />

            <Slider
              label="彩度"
              min={-100}
              max={100}
              value={adjustments.saturation}
              onChange={(v) => updateAdjustment("saturation", v)}
            />

            <button
              className="dr-reset"
              onClick={() => {
                setAdjustments(defaultAdjustments);
                setBeforeAfter(100);
                setProfile("camera-natural");
                setMonochrome(false);
                setHdr(false);
              }}
            >
              リセット
            </button>
          </aside>
        </>
      )}
    </>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  formatValue = (v) => `${v}`,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  return (
    <label className="dr-slider">
      <div className="dr-slider-row">
        <span>{label}</span>
        <span>{formatValue(value)}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
