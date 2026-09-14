import { NextResponse, type NextRequest } from "next/server";
import { getAdminDb } from "@/lib/db";
import { getAppSettings, setAppSetting } from "@saveany/db";
import type { AiModelSettings, AsrProvider, LlmProvider } from "@saveany/shared";

const PROVIDERS: LlmProvider[] = ["deepseek", "dashscope"];
const ASR_PROVIDERS: AsrProvider[] = ["dashscope", "azure"];

function isLlmProvider(v: unknown): v is LlmProvider {
  return typeof v === "string" && (PROVIDERS as string[]).includes(v);
}

function isAsrProvider(v: unknown): v is AsrProvider {
  return typeof v === "string" && (ASR_PROVIDERS as string[]).includes(v);
}

function validModel(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= 100;
}

/** GET /api/settings — 读取当前模型配置 */
export async function GET() {
  try {
    const settings = await getAppSettings(getAdminDb());
    return NextResponse.json({ data: settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取模型配置失败" },
      { status: 500 }
    );
  }
}

/** PUT /api/settings — 保存模型配置（llm.provider / llm.model / asr.model） */
export async function PUT(req: NextRequest) {
  let body: Partial<AiModelSettings>;
  try {
    body = (await req.json()) as Partial<AiModelSettings>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const provider = body.llm?.provider;
  const llmModel = body.llm?.model;
  const asrModel = body.asr?.model;
  const asrProvider = body.asr?.provider; // 可为 undefined（自动）或 dashscope / azure
  const azureRegion = body.asr?.azureRegion;
  const azureLocale = body.asr?.azureLocale;
  if (!isLlmProvider(provider)) {
    return NextResponse.json({ error: "LLM 服务通道无效" }, { status: 400 });
  }
  if (!validModel(llmModel)) {
    return NextResponse.json({ error: "LLM 模型名不能为空且不超过 100 字符" }, { status: 400 });
  }
  if (!validModel(asrModel)) {
    return NextResponse.json({ error: "ASR 模型名不能为空且不超过 100 字符" }, { status: 400 });
  }
  if (asrProvider !== undefined && !isAsrProvider(asrProvider)) {
    return NextResponse.json({ error: "ASR 转写后端无效（可选：dashscope / azure / 自动）" }, { status: 400 });
  }
  if (azureRegion !== undefined && !validModel(azureRegion)) {
    return NextResponse.json({ error: "Azure 区域不能为空且不超过 100 字符" }, { status: 400 });
  }
  if (azureLocale !== undefined && !validModel(azureLocale)) {
    return NextResponse.json({ error: "Azure 语种不能为空且不超过 100 字符" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const writes: Promise<void>[] = [
      setAppSetting(db, "llm.provider", provider),
      setAppSetting(db, "llm.model", llmModel.trim()),
      setAppSetting(db, "asr.model", asrModel.trim()),
    ];
    // 显式传入才落库；未传（自动）不写，读取时回退"自动"语义
    if (asrProvider !== undefined) writes.push(setAppSetting(db, "asr.provider", asrProvider));
    if (azureRegion !== undefined) writes.push(setAppSetting(db, "asr.azureRegion", azureRegion.trim()));
    if (azureLocale !== undefined) writes.push(setAppSetting(db, "asr.azureLocale", azureLocale.trim()));
    await Promise.all(writes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}