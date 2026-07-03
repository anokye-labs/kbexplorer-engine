export type EnginePlaceholder = {
  readonly kind: 'placeholder';
};

export const loadKnowledgeBase = async (): Promise<EnginePlaceholder> => {
  throw new Error('Not implemented yet: loadKnowledgeBase');
};

export const orchestrator = Object.freeze({ status: 'placeholder' });
export const transforms = Object.freeze({ status: 'placeholder' });
export const buildGraph = (): EnginePlaceholder => {
  throw new Error('Not implemented yet: buildGraph');
};
export const providers = Object.freeze({ status: 'placeholder' });
export const nodeTypes = Object.freeze({ status: 'placeholder' });
export const contentModel = Object.freeze({ status: 'placeholder' });
export const identity = Object.freeze({ status: 'placeholder' });
export const parser = Object.freeze({ status: 'placeholder' });
export const queryHelpers = Object.freeze({ status: 'placeholder' });
