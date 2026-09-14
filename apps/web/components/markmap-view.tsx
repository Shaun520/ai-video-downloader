"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

interface MarkmapViewProps {
  markdown: string;
  height?: number;
}

/** 将 markdown 渲染为 markmap 思维导图 */
export function MarkmapView({ markdown, height = 480 }: MarkmapViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current || !markdown.trim()) return;

    const { root } = transformer.transform(markdown);
    const mm = Markmap.create(svgRef.current, {
      autoFit: true,
      duration: 300,
      maxWidth: 300,
      initialExpandLevel: 3,
      paddingX: 12,
    }, root);
    mmRef.current = mm;

    // fit 动画延迟一次，保证容器尺寸就绪
    const t = setTimeout(() => mm.fit(), 80);

    return () => {
      clearTimeout(t);
      mmRef.current?.destroy();
      mmRef.current = null;
      if (svgRef.current) svgRef.current.innerHTML = "";
    };
  }, [markdown]);

  return (
    <div className="markmap-container w-full" style={{ height }}>
      <svg ref={svgRef} className="border-0" role="img" aria-label="视频内容思维导图" />
    </div>
  );
}