/**
 * Proposing contracts.
 *
 * Nobody writes assertions for twenty workflows by hand, which is why the
 * checks people do write are the ones written after an incident, one per scar.
 * So the system proposes, and a person confirms.
 *
 * Every proposal carries the basis it was derived from and says so in the
 * review queue, because a reviewer approving forty checks in an afternoon
 * deserves to know which of them can establish that the workflow is correct and
 * which merely record what it has been doing. That distinction is invisible in
 * every tool that presents a learned baseline as a "check".
 *
 * These functions are deterministic and pure. The model-assisted proposer lives
 * in ./llm and produces exactly the same Proposal type, which is the point: a
 * model gets no privileged path to a green tick.
 */
import type { Assertion, Run } from './types';
import type { Sink } from './sinks';
import type { N8nWorkflowDoc } from '../graph/hash';
export interface Proposal {
    readonly assertion: Assertion;
    /** Why this is being suggested, written for the person reviewing it. */
    readonly rationale: string;
    readonly confidence: 'low' | 'moderate' | 'high';
    readonly derivedFrom: {
        readonly kind: 'structure';
        readonly workflowHash: string;
    } | {
        readonly kind: 'observation';
        readonly runIds: readonly string[];
        readonly sampleSize: number;
    } | {
        readonly kind: 'intent';
        readonly proposedBy: string;
    };
}
/**
 * What the graph itself promises.
 *
 * Basis `structure`: these prove the workflow does what its own definition says.
 * They cannot prove the definition was right, and the review queue says so.
 */
export declare function proposeFromStructure(workflowId: string, workflowHash: string, sinks: readonly Sink[]): readonly Proposal[];
/**
 * What the workflow has been doing.
 *
 * Basis `observation`: every proposal here is circular until a human attests
 * that the window it was learned from was good. They are still worth making,
 * because change detection is genuinely useful, but they are labelled honestly
 * and the confirmation gate will not let them through on a shrug.
 */
export declare function proposeFromObservation(workflowId: string, sinks: readonly Sink[], runs: readonly Run[]): readonly Proposal[];
/**
 * Everything the deterministic proposers can offer for one workflow.
 *
 * Intent-basis proposals are not produced here, because intent cannot be
 * derived from the artefact. It has to be stated by someone who knows what the
 * workflow is for, either directly or with a model reading the graph and asking
 * (see ./llm). That is not a limitation to work around; it is the reason the
 * output of this system means anything.
 */
export declare function proposeAll(args: {
    readonly workflowId: string;
    readonly workflowHash: string;
    readonly doc: N8nWorkflowDoc;
    readonly sinks: readonly Sink[];
    readonly runs: readonly Run[];
}): readonly Proposal[];
