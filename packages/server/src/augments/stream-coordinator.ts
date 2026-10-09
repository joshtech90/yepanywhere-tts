/**
 * StreamCoordinator - Ties together BlockDetector and AugmentGenerator
 *
 * This module coordinates the streaming markdown rendering pipeline by:
 * 1. Feeding incoming chunks to BlockDetector
 * 2. Processing completed blocks with AugmentGenerator
 * 3. Rendering pending text with inline formatting
 */

import { type Augment, createAugmentGenerator } from "./augment-generator.js";
import { BlockDetector } from "./block-detector.js";
import type { SafeMarkdownRenderOptions } from "./safe-markdown.js";

export type { Augment };

export interface StreamChunkResult {
  raw: string; // The raw chunk to forward to client
  augments: Augment[]; // Any completed block augments
  pendingHtml: string; // Rendered pending text (inline formatting)
}

export interface StreamCoordinator {
  onChunk(chunk: string): Promise<StreamChunkResult>;
  flush(): Promise<{ augments: Augment[]; pendingHtml: string }>;
  reset(): void; // Reset state for new stream
}

export interface StreamCoordinatorOptions {
  safeMarkdownOptions?: SafeMarkdownRenderOptions;
}

const STREAMING_CODE_LIVE_RENDER_MAX_CHARS = 24_000;

/**
 * Creates a StreamCoordinator instance that manages the streaming markdown
 * rendering pipeline.
 *
 * @param config - Optional safe-markdown rendering options
 * @returns Promise that resolves to a StreamCoordinator
 */
export async function createStreamCoordinator(
  config?: StreamCoordinatorOptions,
): Promise<StreamCoordinator> {
  const generator = await createAugmentGenerator();
  const safeMarkdownOptions = config?.safeMarkdownOptions;
  let detector = new BlockDetector();
  let blockIndex = 0;

  return {
    async onChunk(chunk: string): Promise<StreamChunkResult> {
      // Feed chunk to block detector
      const completedBlocks = detector.feed(chunk);

      // Process completed blocks into augments
      const augments: Augment[] = [];
      for (const block of completedBlocks) {
        const augment = await generator.processBlock(
          block,
          blockIndex,
          safeMarkdownOptions,
        );
        augments.push(augment);
        blockIndex++;
      }

      // Check if we're in a streaming code block
      const streamingCodeBlock = detector.getStreamingCodeBlock();
      if (streamingCodeBlock) {
        if (
          streamingCodeBlock.content.length >
          STREAMING_CODE_LIVE_RENDER_MAX_CHARS
        ) {
          return {
            raw: chunk,
            augments,
            pendingHtml: "",
          };
        }

        // Render the streaming code block optimistically at the next block index
        const streamingAugment = await generator.renderStreamingCodeBlock(
          streamingCodeBlock,
          blockIndex,
        );
        augments.push(streamingAugment);
        // Don't render pending as inline text - it's being rendered as a code block
        return {
          raw: chunk,
          augments,
          pendingHtml: "",
        };
      }

      // Check if we're in a streaming list
      const streamingList = detector.getStreamingList();
      if (streamingList) {
        // Render the streaming list optimistically at the next block index
        const streamingAugment = generator.renderStreamingList(
          streamingList,
          blockIndex,
          safeMarkdownOptions,
        );
        augments.push(streamingAugment);
        // Don't render pending as inline text - it's being rendered as a list
        return {
          raw: chunk,
          augments,
          pendingHtml: "",
        };
      }

      // Render pending text with inline formatting
      const pendingHtml = generator.renderPending(detector.pending);

      return {
        raw: chunk,
        augments,
        pendingHtml,
      };
    },

    async flush(): Promise<{ augments: Augment[]; pendingHtml: string }> {
      // Get any final incomplete block
      const finalBlocks = detector.flush();

      // Process final blocks into augments
      const augments: Augment[] = [];
      for (const block of finalBlocks) {
        const augment = await generator.processBlock(
          block,
          blockIndex,
          safeMarkdownOptions,
        );
        augments.push(augment);
        blockIndex++;
      }

      return {
        augments,
        pendingHtml: "", // No pending after flush
      };
    },

    reset(): void {
      // Create fresh detector and reset block index
      detector = new BlockDetector();
      blockIndex = 0;
    },
  };
}
