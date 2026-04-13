import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { parseBookRules } from "../models/book-rules.js";
import {
  ChapterBriefSchema,
  ChapterIntentSchema,
  type ChapterBrief,
  type ChapterConflict,
  type ChapterIntent,
} from "../models/input-governance.js";
import {
  parseChapterSummariesMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
} from "../utils/memory-retrieval.js";
import { analyzeChapterCadence, analyzeObjectiveCycle, type ObjectiveCycleAnalysis } from "../utils/chapter-cadence.js";
import { buildPlannerHookAgenda } from "../utils/hook-agenda.js";
import {
  gatherPlanningMaterials,
  loadPlanningSeedMaterials,
  type PlanningMaterials,
} from "../utils/planning-materials.js";
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  type PlannerPromptInput,
} from "./planner-prompts.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly brief: ChapterBrief;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const seedMaterials = await loadPlanningSeedMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
    });
    const outlineNode = this.findOutlineNode(seedMaterials.volumeOutline, input.chapterNumber);
    const matchedOutlineAnchor = this.hasMatchedOutlineAnchor(seedMaterials.volumeOutline, input.chapterNumber);
    const goal = this.deriveGoal(
      input.externalContext,
      seedMaterials.currentFocus,
      seedMaterials.authorIntent,
      outlineNode,
      input.chapterNumber,
    );
    const parsedRules = parseBookRules(seedMaterials.bookRulesRaw);
    const mustKeep = this.collectMustKeep(seedMaterials.currentState, seedMaterials.storyBible);
    const mustAvoid = this.collectMustAvoid(seedMaterials.currentFocus, parsedRules.rules.prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(seedMaterials.authorIntent, seedMaterials.currentFocus);
    const conflicts = this.collectConflicts(input.externalContext, seedMaterials.currentFocus, outlineNode, seedMaterials.volumeOutline);
    const planningAnchor = conflicts.length > 0 ? undefined : outlineNode;
    const materials = await gatherPlanningMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: planningAnchor,
      mustKeep,
      seed: seedMaterials,
    });
    const memorySelection = materials.memorySelection;
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;
    const hookAgenda = buildPlannerHookAgenda({
      hooks: memorySelection.activeHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
      language: input.book.language ?? "zh",
    });
    const { cycleAnalysis, ...directives } = this.buildStructuredDirectives({
      chapterNumber: input.chapterNumber,
      language: input.book.language,
      volumeOutline: seedMaterials.volumeOutline,
      outlineNode,
      matchedOutlineAnchor,
      chapterSummaries: materials.chapterSummariesRaw,
      hookAgenda: {
        eligibleResolve: hookAgenda.eligibleResolve,
        staleDebt: hookAgenda.staleDebt,
      },
    });

    const brief = await this.planChapterBrief({
      input,
      outlineNode: planningAnchor,
      materials,
      cycleAnalysis,
    });

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal: brief.goal,
      outlineNode,
      ...directives,
      mustKeep,
      mustAvoid,
      styleEmphasis: this.mergeBriefStyleEmphasis(styleEmphasis, brief),
      sceneDirective: this.buildSceneDirectiveFromBrief(brief),
      arcDirective: this.buildArcDirectiveFromBrief(brief),
      conflicts,
      hookAgenda,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      brief,
      input.book.language ?? "zh",
      renderHookSnapshot(memorySelection.hooks, input.book.language ?? "zh"),
      renderSummarySnapshot(memorySelection.summaries, input.book.language ?? "zh"),
      activeHookCount,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      brief,
      intentMarkdown,
      plannerInputs: materials.plannerInputs,
      runtimePath,
    };
  }

  private async planChapterBrief(params: {
    readonly input: PlanChapterInput;
    readonly outlineNode: string | undefined;
    readonly materials: PlanningMaterials;
    readonly cycleAnalysis?: ObjectiveCycleAnalysis;
  }): Promise<ChapterBrief> {
    const language = this.isChineseLanguage(params.input.book.language) ? "zh" : "en";
    const response = await this.chat([
      {
        role: "system",
        content: buildPlannerSystemPrompt(language),
      },
      {
        role: "user",
        content: buildPlannerUserPrompt({
          chapterNumber: params.input.chapterNumber,
          targetChapters: params.input.book.targetChapters,
          genreName: params.input.book.genre,
          language,
          materials: {
            ...params.materials,
            outlineNode: params.outlineNode,
          },
          cycleAnalysis: params.cycleAnalysis,
        }),
      },
    ], {
      temperature: 0.2,
      maxTokens: 4096,
    });

    this.log?.info(`[planner] Raw brief response length: ${response.content.length} chars`);
    const parsed = this.tryParseChapterBrief(response.content, params.input.chapterNumber);
    if (!parsed) {
      this.log?.warn(`[planner] Full raw output:\n${response.content}`);
      throw new Error(`Planner LLM returned invalid ChapterBrief JSON. Raw output: ${response.content.slice(0, 500)}`);
    }
    return parsed;
  }

  private tryParseChapterBrief(text: string, chapterNumber: number): ChapterBrief | null {
    const inject = (t: string) => this.injectChapterNumber(t, chapterNumber);
    const direct = this.tryParseExactChapterBrief(inject(text));
    if (direct) {
      return direct;
    }
    const candidate = extractBalancedJsonObject(text);
    if (!candidate) {
      return null;
    }
    return this.tryParseExactChapterBrief(inject(candidate));
  }

  /** Ensure the parsed JSON has a chapter field — LLMs often omit it. */
  private injectChapterNumber(text: string, chapterNumber: number): string {
    try {
      const obj = JSON.parse(text);
      if (typeof obj === "object" && obj !== null && obj.chapter === undefined) {
        obj.chapter = chapterNumber;
        return JSON.stringify(obj);
      }
    } catch { /* not valid JSON yet, pass through */ }
    return text;
  }

  private tryParseExactChapterBrief(text: string): ChapterBrief | null {
    try {
      const raw = JSON.parse(text);
      const normalized = this.normalizeBriefJson(raw);
      return ChapterBriefSchema.parse(normalized);
    } catch (err) {
      if (err instanceof Error && err.name === "ZodError") {
        this.log?.warn(`[planner] Zod validation errors: ${err.message}`);
      }
      return null;
    }
  }

  private static readonly VALID_MOVEMENTS = new Set([
    "quiet-hold", "refresh", "advance", "partial-payoff", "full-payoff",
  ]);

  /**
   * Normalize common LLM deviations from the ChapterBrief schema:
   * - hookPlan[].note → hookPlan[].targetEffect
   * - hookPlan[].movement unknown values → "advance"
   * - propsAndSetting as object → flatten to string[]
   */
  private normalizeBriefJson(raw: Record<string, unknown>): Record<string, unknown> {
    // Normalize hookPlan
    if (Array.isArray(raw.hookPlan)) {
      raw.hookPlan = raw.hookPlan.map((hook: Record<string, unknown>) => {
        const normalized = { ...hook };
        // rename note → targetEffect
        if (normalized.note && !normalized.targetEffect) {
          normalized.targetEffect = normalized.note;
          delete normalized.note;
        }
        // clamp unknown movements to "advance"
        if (typeof normalized.movement === "string" && !PlannerAgent.VALID_MOVEMENTS.has(normalized.movement)) {
          normalized.movement = "advance";
        }
        return normalized;
      });
    }

    // Normalize propsAndSetting: flatten object to string[]
    if (raw.propsAndSetting && !Array.isArray(raw.propsAndSetting)) {
      const obj = raw.propsAndSetting as Record<string, unknown>;
      const flattened: string[] = [];
      for (const values of Object.values(obj)) {
        if (Array.isArray(values)) {
          flattened.push(...values.filter((v): v is string => typeof v === "string"));
        } else if (typeof values === "string") {
          flattened.push(values);
        }
      }
      raw.propsAndSetting = flattened;
    }

    return raw;
  }

  private buildStructuredDirectives(input: {
    readonly chapterNumber: number;
    readonly language?: string;
    readonly volumeOutline: string;
    readonly outlineNode: string | undefined;
    readonly matchedOutlineAnchor: boolean;
    readonly chapterSummaries: string;
    readonly hookAgenda?: {
      readonly eligibleResolve: ReadonlyArray<string>;
      readonly staleDebt: ReadonlyArray<string>;
    };
  }): Pick<ChapterIntent, "sceneDirective" | "arcDirective" | "moodDirective" | "titleDirective"> & {
    readonly cycleAnalysis?: ObjectiveCycleAnalysis;
  } {
    const language = this.isChineseLanguage(input.language) ? "zh" as const : "en" as const;
    const recentSummaries = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-5);
    const cadenceRows = recentSummaries.map((summary) => ({
      chapter: summary.chapter,
      title: summary.title,
      mood: summary.mood,
      chapterType: summary.chapterType,
    }));
    const cadence = analyzeChapterCadence({
      language,
      rows: cadenceRows,
    });

    const cycleAnalysis = input.hookAgenda
      ? analyzeObjectiveCycle({
          rows: cadenceRows,
          hookAgenda: input.hookAgenda,
          language,
        })
      : undefined;

    return {
      arcDirective: this.buildArcDirective(
        input.language,
        input.volumeOutline,
        input.outlineNode,
        input.matchedOutlineAnchor,
      ),
      sceneDirective: this.buildSceneDirective(input.language, cadence),
      moodDirective: cycleAnalysis
        ? this.buildCycleDirective(input.language, cycleAnalysis)
        : this.buildMoodDirective(input.language, cadence),
      titleDirective: this.buildTitleDirective(input.language, cadence),
      cycleAnalysis,
    };
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    outlineNode: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "禁止",
      "避免",
      "避雷",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /avoid|don't|do not|不要|别|禁止/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
  }

  private collectConflicts(
    externalContext: string | undefined,
    currentFocus: string,
    outlineNode: string | undefined,
    volumeOutline: string,
  ): ChapterConflict[] {
    const outlineText = outlineNode ?? volumeOutline;
    if (!outlineText || outlineText === "(文件尚未创建)") return [];
    if (externalContext) {
      const indicatesOverride = /ignore|skip|defer|instead|不要|别|先别|暂停/i.test(externalContext);
      if (!indicatesOverride && this.hasKeywordOverlap(externalContext, outlineText)) return [];

      return [
        {
          type: "outline_vs_request",
          resolution: "allow local outline deferral",
        },
      ];
    }

    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (!localOverride || !outlineNode) {
      return [];
    }

    return [
      {
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
        detail: localOverride,
      },
    ];
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "局部覆盖",
      "本章覆盖",
      "临时覆盖",
      "当前覆盖",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private buildArcDirective(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
    matchedOutlineAnchor: boolean,
  ): string | undefined {
    if (matchedOutlineAnchor || !outlineNode || volumeOutline === "(文件尚未创建)") {
      return undefined;
    }

    return this.isChineseLanguage(language)
      ? "不要继续依赖卷纲的 fallback 指令，必须把本章推进到新的弧线节点或地点变化。"
      : "Do not keep leaning on the outline fallback. Force this chapter toward a fresh arc beat or location change.";
  }

  private buildSceneDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.scenePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedType = cadence.scenePressure.repeatedType;

    return this.isChineseLanguage(language)
      ? `最近章节连续停留在“${repeatedType}”，本章必须更换场景容器、地点或行动方式。`
      : `Recent chapters are stuck in repeated ${repeatedType} beats. Change the scene container, location, or action pattern this chapter.`;
  }

  private buildMoodDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.moodPressure?.pressure !== "high") {
      return undefined;
    }
    const moods = cadence.moodPressure.recentMoods;

    return this.isChineseLanguage(language)
      ? `最近${moods.length}章情绪持续高压（${moods.slice(0, 3).join("、")}），本章必须降调——安排日常/喘息/温情/幽默场景，让读者呼吸。`
      : `The last ${moods.length} chapters have been relentlessly tense (${moods.slice(0, 3).join(", ")}). This chapter must downshift — write a quieter scene with warmth, humor, or breathing room.`;
  }

  private buildCycleDirective(
    language: string | undefined,
    cycle: ObjectiveCycleAnalysis,
  ): string | undefined {
    const isZh = this.isChineseLanguage(language);
    switch (cycle.phase) {
      case "蓄压":
        return isZh
          ? "本章铺压制，新阻力或新信息——不急着爆发。"
          : "This chapter builds pressure — introduce new obstacles or information. Don't rush to climax.";
      case "升级":
        return isZh
          ? "本章升级冲突，已有缺口还没释放——加码不松手。"
          : "This chapter escalates conflict — existing gaps are unresolved. Raise the stakes, don't relent.";
      case "爆发":
        return isZh
          ? "本章有一个承诺必须兑现——让积累的压力落地，给读者超预期的释放。"
          : "This chapter must deliver on a promise — release accumulated pressure with a payoff that exceeds expectations.";
      case "后效":
        return isZh
          ? "上一章刚爆发，写改变：关系变了、地位变了、代价显现了。"
          : "Previous chapter just climaxed — write the aftermath: changed relationships, shifted status, visible costs.";
    }
  }

  private buildTitleDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.titlePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedToken = cadence.titlePressure.repeatedToken;

    return this.isChineseLanguage(language)
      ? `标题不要再围绕“${repeatedToken}”重复命名，换一个新的意象或动作焦点。`
      : `Avoid another ${repeatedToken}-centric title. Pick a new image or action focus for this chapter title.`;
  }

  private renderHookBudget(activeCount: number, language: "zh" | "en"): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
      || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
    );
  }

  private containsChinese(content: string): boolean {
    return /[\u4e00-\u9fff]/.test(content);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return inlineContent;
      }

      // For "章节范围" format, the volume title is above this line.
      // Collect the heading + all content below until the next heading,
      // then pick the beat corresponding to this specific chapter.
      const rangeStart = Number(match[1]);
      const sectionContent = this.extractSectionAroundRange(lines, index);
      if (sectionContent) {
        const beatIndex = chapterNumber - rangeStart;
        const specificBeat = this.extractNumberedBeat(sectionContent, beatIndex);
        return specificBeat ?? sectionContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }

      break;
    }

    return this.extractFirstDirective(volumeOutline);
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  /**
   * For "章节范围：13-17章" format, extract the full section:
   * look upward for the volume heading, then collect everything
   * from the heading down to the next heading of the same or higher level.
   */
  private extractSectionAroundRange(lines: ReadonlyArray<string>, rangeLineIndex: number): string | undefined {
    // Walk backward to find the nearest heading (### or ##)
    // Only activate for "章节范围" style outlines where the heading is above.
    let headingIndex = -1;
    for (let i = rangeLineIndex - 1; i >= 0; i--) {
      if (lines[i]!.startsWith("#")) {
        headingIndex = i;
        break;
      }
      // Stop if we hit another range/anchor line (means no heading above)
      if (this.matchAnyRangeOutlineLine(lines[i]!) || this.matchAnyExactOutlineLine(lines[i]!)) {
        break;
      }
    }

    // If no heading found above, this isn't the "章节范围" format — bail out
    if (headingIndex < 0) {
      return undefined;
    }

    // Determine the heading level to know where this section ends
    const headingLine = lines[headingIndex]!;
    const headingLevel = headingLine.match(/^(#+)/)?.[1]?.length ?? 3;

    // Collect lines from heading to next same-or-higher heading
    const sectionLines: string[] = [];
    for (let i = headingIndex; i < lines.length; i++) {
      if (i > headingIndex) {
        const nextHeadingMatch = lines[i]!.match(/^(#+)/);
        if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingLevel) {
          break;
        }
      }
      sectionLines.push(lines[i]!);
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : undefined;
  }

  /**
   * Extract the Nth numbered beat from a section.
   * Beats are lines starting with "1.", "2.", "3." etc. in "关键转折" blocks.
   * beatIndex=0 → 1st beat, beatIndex=1 → 2nd beat, etc.
   */
  private extractNumberedBeat(section: string, beatIndex: number): string | undefined {
    if (beatIndex < 0) return undefined;

    const beats: string[] = [];
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      // Match "1. ...", "2. ..." or "1) ..." patterns
      if (/^\d+[.)]\s/.test(trimmed)) {
        beats.push(trimmed.replace(/^\d+[.)]\s*/, ""));
      }
    }

    if (beats.length === 0 || beatIndex >= beats.length) return undefined;
    return beats[beatIndex];
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private hasMatchedOutlineAnchor(volumeOutline: string, chapterNumber: number): boolean {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.some((line) =>
      this.matchExactOutlineLine(line, chapterNumber) !== undefined
      || this.matchRangeOutlineLine(line, chapterNumber) !== undefined,
    );
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      // Match "**章节范围**：13-17章" / "- **章节范围**：13-17章" format
      /^(?:[-*]\s+)?(?:\*\*)?章节范围(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*章\s*(.*)$/,
      /^(?:[-*]\s+)?(?:\*\*)?Chapter\s*[Rr]ange(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\b\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private hasKeywordOverlap(left: string, right: string): boolean {
    const keywords = this.extractKeywords(left);
    if (keywords.length === 0) return false;
    const normalizedRight = right.toLowerCase();
    return keywords.some((keyword) => normalizedRight.includes(keyword.toLowerCase()));
  }

  private extractKeywords(content: string): string[] {
    const english = content.match(/[a-z]{4,}/gi) ?? [];
    const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    return this.unique([...english, ...chinese]);
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    brief: ChapterBrief | undefined,
    language: "zh" | "en",
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
  ): string {
    const conflictLines = intent.conflicts.length > 0
      ? intent.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.resolution}`).join("\n")
      : "- none";

    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";
    const directives = [
      intent.arcDirective ? `- arc: ${intent.arcDirective}` : undefined,
      intent.sceneDirective ? `- scene: ${intent.sceneDirective}` : undefined,
      intent.moodDirective ? `- mood: ${intent.moodDirective}` : undefined,
      intent.titleDirective ? `- title: ${intent.titleDirective}` : undefined,
    ].filter(Boolean).join("\n") || "- none";
    const isEn = language === "en";
    const hookAgenda = [
      isEn ? "### Resolve — must deliver a concrete payoff this chapter" : "### 兑现（本章必须落地具体回收）",
      intent.hookAgenda.eligibleResolve.length > 0
        ? intent.hookAgenda.eligibleResolve.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none this round" : "- 本轮无",
      "",
      isEn ? "### Advance — must show visible progress this chapter" : "### 推进（本章必须有可见进展）",
      intent.hookAgenda.mustAdvance.length > 0
        ? intent.hookAgenda.mustAdvance.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none this round" : "- 本轮无",
      "",
      isEn ? "### Stale Debt — overdue hooks, prioritize clearing" : "### 逾期债务（积压伏笔，优先清理）",
      intent.hookAgenda.staleDebt.length > 0
        ? intent.hookAgenda.staleDebt.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none" : "- 无",
      "",
      isEn ? "### Do Not Open — avoid new hooks in these families" : "### 禁开新坑（以下类型不得新增伏笔）",
      intent.hookAgenda.avoidNewHookFamilies.length > 0
        ? intent.hookAgenda.avoidNewHookFamilies.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none" : "- 无",
      "",
      this.renderHookBudget(activeHookCount, language),
    ].join("\n");

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      ...(brief ? [
        "## Chapter Brief",
        `- chapterType: ${brief.chapterType}`,
        `- isGoldenOpening: ${brief.isGoldenOpening ? "true" : "false"}`,
        ...(brief.cyclePhase ? [`- cyclePhase: ${brief.cyclePhase}`] : []),
        `- dormantReason: ${brief.dormantReason ?? "(none)"}`,
        "",
        "### Beat Outline",
        ...brief.beatOutline.map((beat) => `- ${beat.phase}: ${beat.instruction}`),
        "",
        "### Hook Plan",
        ...(brief.hookPlan.length > 0
          ? brief.hookPlan.map((item) => `- ${item.hookId}: ${item.movement} -> ${item.targetEffect}`)
          : ["- none"]),
        "",
        "### Props And Setting",
        ...(brief.propsAndSetting.length > 0
          ? brief.propsAndSetting.map((item) => `- ${item}`)
          : ["- none"]),
        "",
      ] : []),
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Structured Directives",
      directives,
      "",
      "## Hook Agenda",
      hookAgenda,
      "",
      "## Conflicts",
      conflictLines,
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private buildSceneDirectiveFromBrief(brief: ChapterBrief): string {
    const props = brief.propsAndSetting.length > 0
      ? ` Use these on-page anchors: ${brief.propsAndSetting.join(", ")}.`
      : "";
    return `Run this as a ${brief.chapterType} chapter.${props}`.trim();
  }

  private buildArcDirectiveFromBrief(brief: ChapterBrief): string {
    return brief.beatOutline
      .map((beat) => `${beat.phase}: ${beat.instruction}`)
      .join(" | ");
  }

  private mergeBriefStyleEmphasis(styleEmphasis: ReadonlyArray<string>, brief: ChapterBrief): string[] {
    const derived = brief.isGoldenOpening
      ? ["Honor golden-opening pacing without leaking chapter-planning meta language."]
      : [];
    return this.unique([...styleEmphasis, ...derived]);
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isChineseLanguage(language: string | undefined): boolean {
    return (language ?? "zh").toLowerCase().startsWith("zh");
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}
