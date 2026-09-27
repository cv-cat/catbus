import { readFileSync } from 'node:fs'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'
import { compactJson } from '../../../core/py.js'

/**
 * GraphQL 操作装配，移植自上游 utils/graphql_registry.py + builder/params.py。
 *
 * queryId 与 features 不写死，全部取自 `static/x/graphql.json`（上游从线上前端机器提取的注册表）。
 * 前端发版后在上游跑 `python main.py refresh-graphql`，再把 graphql.json 原样同步过来。
 */

const GRAPHQL_BASE = 'https://x.com/i/api/graphql'

interface Operation {
  queryId: string
  operationType: string
  featureSwitches: string[]
  fieldToggles: string[]
}

interface Registry {
  operations: Record<string, Operation>
  featureDefaults: Record<string, boolean>
}

let cached: Registry | null = null

function registry(): Registry {
  cached ??= JSON.parse(readFileSync(staticFile('x', 'graphql.json'), 'utf8')) as Registry
  return cached
}

/**
 * 浏览器在各操作上实际发送的 fieldToggles 子集（上游 BROWSER_FIELD_TOGGLES，2026-08-16 实抓）。
 * null 表示浏览器不发 fieldToggles；没登记的操作退回注册表全集。
 */
const BROWSER_FIELD_TOGGLES: Record<string, Record<string, boolean> | null> = {
  SearchTimeline: null,
  HomeTimeline: null,
  CreateTweet: null,
  UserByScreenName: { withPayments: false, withAuxiliaryUserLabels: true },
  UserTweets: { withArticlePlainText: false },
  UserOriginalsTimeline: { withPayments: false, withArticlePlainText: false },
  TweetDetail: {
    withPayments: false,
    withArticleRichContentState: true,
    withArticlePlainText: false,
    withArticleSummaryText: true,
    withArticleVoiceOver: true,
    withGrokAnalyze: false,
    withDisallowedReplyControls: false,
  },
  TweetResultByRestId: {
    withArticleRichContentState: true,
    withArticlePlainText: false,
    withArticleSummaryText: true,
    withArticleVoiceOver: true,
    withPayments: false,
  },
}

/** 一个 GraphQL 操作的完整请求形态（上游 GraphQLOperation）。 */
export class GraphQLOperation {
  private readonly meta: Operation

  constructor(readonly name: string) {
    const op = registry().operations[name]
    if (!op) throw new CatbusError('UPSTREAM', `GraphQL 注册表里没有操作 ${name}，可能是前端改名或本地注册表过期`)
    this.meta = op
  }

  /** XCTID 要的 pathname：与真实请求路径一致，不含 query。 */
  path(): string {
    return `/i/api/graphql/${this.meta.queryId}/${this.name}`
  }

  url(): string {
    return `${GRAPHQL_BASE}/${this.meta.queryId}/${this.name}`
  }

  /** 按操作声明的开关名，从 defaults 取布尔值（上游 build_features）。 */
  private features(): Record<string, boolean> {
    const defaults = registry().featureDefaults
    return Object.fromEntries(this.meta.featureSwitches.map((k) => [k, defaults[k] ?? false]))
  }

  /** 浏览器实抓的子集，没登记时用注册表全集（上游 _resolve_toggles）。 */
  private fieldToggles(): Record<string, boolean> | null {
    if (this.name in BROWSER_FIELD_TOGGLES) return BROWSER_FIELD_TOGGLES[this.name]!
    const defaults = registry().featureDefaults
    return Object.fromEntries(this.meta.fieldToggles.map((k) => [k, defaults[k] ?? false]))
  }

  /** GET 型操作的 query 参数；features / fieldToggles 为空时不带（上游 query_params）。 */
  queryParams(variables: Map<string, unknown>): [string, string][] {
    const params: [string, string][] = [['variables', compactJson(variables)]]
    const features = this.features()
    if (Object.keys(features).length) params.push(['features', compactJson(features)])
    const toggles = this.fieldToggles()
    if (toggles && Object.keys(toggles).length) params.push(['fieldToggles', compactJson(toggles)])
    return params
  }

  /** POST 型操作的请求体：variables [+ features] [+ fieldToggles] + queryId（上游 json_body）。 */
  jsonBody(variables: Map<string, unknown>): Map<string, unknown> {
    const body = new Map<string, unknown>([['variables', variables]])
    const features = this.features()
    if (Object.keys(features).length) body.set('features', features)
    const toggles = this.fieldToggles()
    if (toggles && Object.keys(toggles).length) body.set('fieldToggles', toggles)
    body.set('queryId', this.meta.queryId)
    return body
  }
}
