import {
  loadCorpusSearchGateway,
  type ReviewStatus,
  type RightsDecision,
  type TranslationProducerClass,
} from "folklore-search";

type Gateway = Awaited<ReturnType<typeof loadCorpusSearchGateway>>;

declare const gateway: Gateway;

const reviewStatus: ReviewStatus =
  gateway.records.translations[0].reviewStatus;
const producerClass: TranslationProducerClass =
  gateway.records.translations[0].producerClass;
const trainingDecision: RightsDecision =
  gateway.records.rightsAssessments[0].mlTrainingAllowed;
const passageId: string = gateway.index.search("forest")[0].id;

// @ts-expect-error verified gateway collections are immutable
gateway.records.rightsAssessments.push({});
// @ts-expect-error verified rights decisions are immutable
gateway.records.rightsAssessments[0].mlTrainingAllowed = true;

void reviewStatus;
void producerClass;
void trainingDecision;
void passageId;
