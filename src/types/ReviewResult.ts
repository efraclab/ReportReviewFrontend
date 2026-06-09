import type { DocumentReview } from "./DocumentReview";


export interface ReviewResult {
    documents: DocumentReview[];
    overallScore: number;
    reviewedAt: string;
}
