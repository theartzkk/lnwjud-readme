const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z][a-z0-9._-]{1,63}$/;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,63}$/;
const SECRETISH = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]/i;

export type ActionNodeKind = 'PLAN'|'RESEARCH'|'EXECUTE'|'VERIFY'|'APPROVAL'|'OUTPUT';
export type ActionNodeState = 'PLANNED'|'READY'|'RUNNING'|'BLOCKED'|'COMPLETED'|'FAILED'|'CANCELLED';
export type CostClass = 'ZERO_TOKEN'|'LOCAL_FREE'|'PAID_AI'|'DETERMINISTIC';
export type UndoPolicy = 'NONE'|'REVERSIBLE'|'SNAPSHOT_REQUIRED';

export interface ActionGraphNode {
  nodeId: string; kind: ActionNodeKind; state: ActionNodeState; capability: string;
  title: string; costClass: CostClass; undoPolicy: UndoPolicy; approvalRequired: boolean;
}
export interface ActionGraphEdge { from: string; to: string; }
export interface ActionGraph {
  schemaVersion: 1; graphId: string; projectId: string; goal: string;
  nodes: ActionGraphNode[]; edges: ActionGraphEdge[];
}

export interface SkillManifest {
  schemaVersion: 1; skillId: string; displayName: string; capability: string;
  costClass: CostClass; approvalRequired: boolean; undoPolicy: UndoPolicy;
  inputKinds: string[]; outputKinds: string[];
}
export interface ConnectorManifest {
  schemaVersion: 1; connectorId: string; displayName: string; authority: 'READ_ONLY'|'BOUNDED_WRITE';
  operations: Array<'READ'|'SEARCH'|'ACTION'>; approvalForActions: boolean;
}
export interface ArtifactEdge { fromArtifactId: string; toArtifactId: string; relation: 'DERIVED_FROM'|'USES'|'EXPORT_OF'|'EVIDENCE_FOR'|'REVISION_OF'; }
export interface TrustEvent { schemaVersion: 1; eventId: string; projectId: string; action: string; provider: string|null; mutation: boolean; approved: boolean|null; }
export interface EvalResult { schemaVersion: 1; evalId: string; capability: string; score: number; releaseBlocking: boolean; evidenceRef: string|null; }

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  const text=value.trim();
  if (!text || text.length>max || /[\u0000-\u001f\u007f]/.test(text) || SECRETISH.test(text)) throw new Error(`${name} is invalid`);
  return text;
}
function uuid(value: unknown, name: string): string { if(typeof value!=='string'||!UUID.test(value)) throw new Error(`${name} is invalid`); return value.toLowerCase(); }
function id(value: unknown, name: string): string { if(typeof value!=='string'||!ID.test(value)) throw new Error(`${name} is invalid`); return value; }
function capability(value: unknown): string { if(typeof value!=='string'||!CAPABILITY.test(value)) throw new Error('capability is invalid'); return value; }

export function validateActionGraph(graph: ActionGraph): ActionGraph {
  if (!graph || graph.schemaVersion!==1) throw new Error('Action Graph schema is invalid');
  uuid(graph.graphId,'graphId'); uuid(graph.projectId,'projectId'); boundedText(graph.goal,'goal',2000);
  if(!Array.isArray(graph.nodes)||graph.nodes.length<1||graph.nodes.length>64) throw new Error('Action Graph nodes are invalid');
  if(!Array.isArray(graph.edges)||graph.edges.length>128) throw new Error('Action Graph edges are invalid');
  const ids=new Set<string>();
  for(const node of graph.nodes){
    id(node.nodeId,'nodeId'); if(ids.has(node.nodeId)) throw new Error('Action Graph node is duplicated'); ids.add(node.nodeId);
    if(!['PLAN','RESEARCH','EXECUTE','VERIFY','APPROVAL','OUTPUT'].includes(node.kind)) throw new Error('Action node kind is invalid');
    if(!['PLANNED','READY','RUNNING','BLOCKED','COMPLETED','FAILED','CANCELLED'].includes(node.state)) throw new Error('Action node state is invalid');
    capability(node.capability); boundedText(node.title,'title',160);
    if(!['ZERO_TOKEN','LOCAL_FREE','PAID_AI','DETERMINISTIC'].includes(node.costClass)) throw new Error('Action cost class is invalid');
    if(!['NONE','REVERSIBLE','SNAPSHOT_REQUIRED'].includes(node.undoPolicy)) throw new Error('Action undo policy is invalid');
  }
  const adjacency=new Map<string,string[]>(); const indegree=new Map<string,number>(); for(const nodeId of ids){adjacency.set(nodeId,[]);indegree.set(nodeId,0);}
  const edgeKeys=new Set<string>();
  for(const edge of graph.edges){
    if(!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to) throw new Error('Action Graph edge is invalid');
    const key=`${edge.from}>${edge.to}`; if(edgeKeys.has(key)) throw new Error('Action Graph edge is duplicated'); edgeKeys.add(key);
    adjacency.get(edge.from)?.push(edge.to); indegree.set(edge.to,(indegree.get(edge.to)||0)+1);
  }
  const ready=[...ids].filter(nodeId=>(indegree.get(nodeId)||0)===0); let visited=0;
  while(ready.length){const nodeId=ready.shift()!;visited+=1;for(const next of adjacency.get(nodeId)||[]){const remaining=(indegree.get(next)||0)-1;indegree.set(next,remaining);if(remaining===0)ready.push(next);}}
  if(visited!==ids.size) throw new Error('Action Graph must be acyclic');
  return graph;
}

export function validateSkillManifest(skill: SkillManifest): SkillManifest {
  if(!skill||skill.schemaVersion!==1) throw new Error('Skill schema is invalid');
  id(skill.skillId,'skillId'); boundedText(skill.displayName,'displayName',120); capability(skill.capability);
  if(!['ZERO_TOKEN','LOCAL_FREE','PAID_AI','DETERMINISTIC'].includes(skill.costClass)) throw new Error('Skill cost class is invalid');
  if(!['NONE','REVERSIBLE','SNAPSHOT_REQUIRED'].includes(skill.undoPolicy)) throw new Error('Skill undo policy is invalid');
  for(const list of [skill.inputKinds,skill.outputKinds]) if(!Array.isArray(list)||list.length>24||list.some(v=>typeof v!=='string'||!ID.test(v))) throw new Error('Skill IO contract is invalid');
  return skill;
}

export function validateConnectorManifest(connector: ConnectorManifest): ConnectorManifest {
  if(!connector||connector.schemaVersion!==1) throw new Error('Connector schema is invalid');
  id(connector.connectorId,'connectorId'); boundedText(connector.displayName,'displayName',120);
  if(!['READ_ONLY','BOUNDED_WRITE'].includes(connector.authority)) throw new Error('Connector authority is invalid');
  if(!Array.isArray(connector.operations)||connector.operations.length<1||connector.operations.some(v=>!['READ','SEARCH','ACTION'].includes(v))) throw new Error('Connector operations are invalid');
  if(connector.operations.includes('ACTION')&&connector.authority==='READ_ONLY') throw new Error('Read-only connector cannot mutate');
  if(connector.operations.includes('ACTION')&&!connector.approvalForActions) throw new Error('Connector actions require approval');
  return connector;
}

export function validateArtifactEdge(edge: ArtifactEdge): ArtifactEdge { uuid(edge.fromArtifactId,'fromArtifactId'); uuid(edge.toArtifactId,'toArtifactId'); if(edge.fromArtifactId===edge.toArtifactId||!['DERIVED_FROM','USES','EXPORT_OF','EVIDENCE_FOR','REVISION_OF'].includes(edge.relation)) throw new Error('Artifact relation is invalid'); return edge; }
export function validateTrustEvent(event: TrustEvent): TrustEvent { if(!event||event.schemaVersion!==1) throw new Error('Trust event schema is invalid'); uuid(event.eventId,'eventId'); uuid(event.projectId,'projectId'); id(event.action,'action'); if(event.provider!==null) id(event.provider,'provider'); if(event.mutation&&event.approved===null) throw new Error('Mutation trust event requires an approval decision'); return event; }
export function validateEvalResult(result: EvalResult): EvalResult { if(!result||result.schemaVersion!==1) throw new Error('Eval schema is invalid'); id(result.evalId,'evalId'); capability(result.capability); if(!Number.isFinite(result.score)||result.score<0||result.score>100) throw new Error('Eval score is invalid'); if(result.evidenceRef!==null) boundedText(result.evidenceRef,'evidenceRef',160); return result; }
