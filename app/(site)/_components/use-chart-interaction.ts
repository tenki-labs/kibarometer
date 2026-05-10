"use client";

import { useEffect, useState } from "react";

export function useChartInteraction() {
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const tooltipTrigger: "hover" | "click" = isTouch ? "click" : "hover";

  return { activeKey, setActiveKey, isTouch, tooltipTrigger };
}
