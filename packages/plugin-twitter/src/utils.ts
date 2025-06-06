import fs from 'node:fs';
import path from 'node:path';
import type { Media, ModelTypeName, State } from '@elizaos/core';
import {
  ChannelType,
  type Content,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type UUID,
  composePrompt,
  createUniqueUuid,
  logger,
} from '@elizaos/core';
import type { ClientBase } from './base';
import type { Tweet } from './client';
import type { Tweet as ClientTweet } from './client/tweets';
import type { SttTtsPlugin } from './sttTtsSpaces';
import type { ActionResponse, MediaData } from './types';
import type { Tweet as CoreTweet } from './types';

export const wait = (minTime = 1000, maxTime = 3000) => {
  const waitTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
  return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export const isValidTweet = (tweet: Tweet): boolean => {
  // Filter out tweets with too many hashtags, @s, or $ signs, probably spam or garbage
  const hashtagCount = (tweet.text?.match(/#/g) || []).length;
  const atCount = (tweet.text?.match(/@/g) || []).length;
  const dollarSignCount = (tweet.text?.match(/\$/g) || []).length;
  const totalCount = hashtagCount + atCount + dollarSignCount;

  return hashtagCount <= 1 && atCount <= 2 && dollarSignCount <= 1 && totalCount <= 3;
};

/**
 * Builds a conversation thread starting from a given tweet.
 * @param {Tweet} tweet - The tweet to start building the thread from.
 * @param {ClientBase} client - The client base object.
 * @param {number} [maxReplies=10] - The maximum number of replies to include in the thread.
 * @returns {Promise<Tweet[]>} The conversation thread as an array of tweets.
 */
export async function buildConversationThread(
  tweet: Tweet,
  client: ClientBase,
  maxReplies = 10
): Promise<Tweet[]> {
  const thread: Tweet[] = [];
  const visited: Set<string> = new Set();

  async function processThread(currentTweet: Tweet, depth = 0) {
    logger.debug('Processing tweet:', {
      id: currentTweet.id,
      inReplyToStatusId: currentTweet.inReplyToStatusId,
      depth: depth,
    });

    if (!currentTweet) {
      logger.debug('No current tweet found for thread building');
      return;
    }

    // Stop if we've reached our reply limit
    if (depth >= maxReplies) {
      logger.debug('Reached maximum reply depth', depth);
      return;
    }

    // Handle memory storage
    const memory = await client.runtime.getMemoryById(
      createUniqueUuid(this.runtime, currentTweet.id)
    );
    if (!memory) {
      const roomId = createUniqueUuid(this.runtime, currentTweet.conversationId);
      const entityId = createUniqueUuid(this.runtime, currentTweet.userId);

      await client.runtime.ensureConnection({
        entityId,
        roomId,
        userName: currentTweet.username,
        name: currentTweet.name,
        source: 'twitter',
        type: ChannelType.GROUP,
      });

      await client.runtime.createMemory(
        {
          id: createUniqueUuid(this.runtime, currentTweet.id),
          agentId: client.runtime.agentId,
          content: {
            text: currentTweet.text,
            source: 'twitter',
            url: currentTweet.permanentUrl,
            imageUrls: currentTweet.photos.map((p) => p.url) || [],
            inReplyTo: currentTweet.inReplyToStatusId
              ? createUniqueUuid(this.runtime, currentTweet.inReplyToStatusId)
              : undefined,
          },
          createdAt: currentTweet.timestamp * 1000,
          roomId,
          entityId:
            currentTweet.userId === client.profile.id
              ? client.runtime.agentId
              : createUniqueUuid(this.runtime, currentTweet.userId),
        },
        'messages'
      );
    }

    if (visited.has(currentTweet.id)) {
      logger.debug('Already visited tweet:', currentTweet.id);
      return;
    }

    visited.add(currentTweet.id);
    thread.unshift(currentTweet);

    logger.debug('Current thread state:', {
      length: thread.length,
      currentDepth: depth,
      tweetId: currentTweet.id,
    });

    // If there's a parent tweet, fetch and process it
    if (currentTweet.inReplyToStatusId) {
      logger.debug('Fetching parent tweet:', currentTweet.inReplyToStatusId);
      try {
        const parentTweet = await client.twitterClient.getTweet(currentTweet.inReplyToStatusId);

        if (parentTweet) {
          logger.debug('Found parent tweet:', {
            id: parentTweet.id,
            text: parentTweet.text?.slice(0, 50),
          });
          await processThread(parentTweet, depth + 1);
        } else {
          logger.debug('No parent tweet found for:', currentTweet.inReplyToStatusId);
        }
      } catch (error) {
        logger.error('Error fetching parent tweet:', {
          tweetId: currentTweet.inReplyToStatusId,
          error,
        });
      }
    } else {
      logger.debug('Reached end of reply chain at:', currentTweet.id);
    }
  }

  await processThread(tweet, 0);

  logger.debug('Final thread built:', {
    totalTweets: thread.length,
    tweetIds: thread.map((t) => ({
      id: t.id,
      text: t.text?.slice(0, 50),
    })),
  });

  return thread;
}

/**
 * Fetches media data from a list of attachments, supporting both HTTP URLs and local file paths.
 *
 * @param attachments Array of Media objects containing URLs or file paths to fetch media from
 * @returns Promise that resolves with an array of MediaData objects containing the fetched media data and content type
 */
export async function fetchMediaData(attachments: Media[]): Promise<MediaData[]> {
  return Promise.all(
    attachments.map(async (attachment: Media) => {
      if (/^(http|https):\/\//.test(attachment.url)) {
        // Handle HTTP URLs
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${attachment.url}`);
        }
        const mediaBuffer = Buffer.from(await response.arrayBuffer());
        const mediaType = attachment.contentType || 'image/png';
        return { data: mediaBuffer, mediaType };
      }
      if (fs.existsSync(attachment.url)) {
        // Handle local file paths
        const mediaBuffer = await fs.promises.readFile(path.resolve(attachment.url));
        const mediaType = attachment.contentType || 'image/png';
        return { data: mediaBuffer, mediaType };
      }
      throw new Error(`File not found: ${attachment.url}. Make sure the path is correct.`);
    })
  );
}

/**
 * Sends a tweet on Twitter using the given client.
 *
 * @param {ClientBase} client The client used to send the tweet.
 * @param {Content} content The content of the tweet.
 * @param {UUID} roomId The ID of the room where the tweet will be sent.
 * @param {string} twitterUsername The Twitter username of the sender.
 * @param {string} inReplyTo The ID of the tweet to which the new tweet will reply.
 * @returns {Promise<Memory[]>} An array of memories representing the sent tweets.
 */
export async function sendTweet(
  client: ClientBase,
  content: Content,
  roomId: UUID,
  twitterUsername: string,
  inReplyTo: string
): Promise<Memory[]> {
  const isLongTweet = content.text.length > 280 - 1;

  const tweetChunks = splitTweetContent(content.text, 280 - 1);
  const sentTweets: Tweet[] = [];
  let previousTweetId = inReplyTo;

  for (const chunk of tweetChunks) {
    let mediaData = null;

    if (content.attachments && content.attachments.length > 0) {
      mediaData = await fetchMediaData(content.attachments);
    }

    const cleanChunk = deduplicateMentions(chunk.trim());

    const result = await client.requestQueue.add(async () =>
      isLongTweet
        ? client.twitterClient.sendLongTweet(cleanChunk, previousTweetId, mediaData)
        : client.twitterClient.sendTweet(cleanChunk, previousTweetId, mediaData)
    );

    const body = await result.json();
    const tweetResult = isLongTweet
      ? body?.data?.notetweet_create?.tweet_results?.result
      : body?.data?.create_tweet?.tweet_results?.result;

    // if we have a response
    if (tweetResult) {
      // Parse the response
      const finalTweet: Tweet = {
        id: tweetResult.rest_id,
        text: tweetResult.legacy.full_text,
        conversationId: tweetResult.legacy.conversation_id_str,
        timestamp: new Date(tweetResult.legacy.created_at).getTime() / 1000,
        userId: tweetResult.legacy.user_id_str,
        inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
        permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
        hashtags: [],
        mentions: [],
        photos: [],
        thread: [],
        urls: [],
        videos: [],
      };
      sentTweets.push(finalTweet);
      previousTweetId = finalTweet.id;
    } else {
      logger.error('Error sending tweet chunk:', {
        chunk,
        response: body,
      });
    }

    // Wait a bit between tweets to avoid rate limiting issues
    await wait(1000, 2000);
  }

  const memories: Memory[] = sentTweets.map((tweet) => ({
    id: createUniqueUuid(client.runtime, tweet.id),
    agentId: client.runtime.agentId,
    entityId: client.runtime.agentId,
    content: {
      tweetId: tweet.id,
      text: tweet.text,
      source: 'twitter',
      url: tweet.permanentUrl,
      imageUrls: tweet.photos.map((p) => p.url) || [],
      inReplyTo: tweet.inReplyToStatusId
        ? createUniqueUuid(client.runtime, tweet.inReplyToStatusId)
        : undefined,
    },
    roomId,
    createdAt: tweet.timestamp * 1000,
  }));

  return memories;
}

/**
 * Splits the given content into individual tweets based on the maximum length allowed for a tweet.
 * @param {string} content - The content to split into tweets.
 * @param {number} maxLength - The maximum length allowed for a single tweet.
 * @returns {string[]} An array of strings representing individual tweets.
 */
function splitTweetContent(content: string, maxLength: number): string[] {
  const paragraphs = content.split('\n\n').map((p) => p.trim());
  const tweets: string[] = [];
  let currentTweet = '';

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;

    if (`${currentTweet}\n\n${paragraph}`.trim().length <= maxLength) {
      if (currentTweet) {
        currentTweet += `\n\n${paragraph}`;
      } else {
        currentTweet = paragraph;
      }
    } else {
      if (currentTweet) {
        tweets.push(currentTweet.trim());
      }
      if (paragraph.length <= maxLength) {
        currentTweet = paragraph;
      } else {
        // Split long paragraph into smaller chunks
        const chunks = splitParagraph(paragraph, maxLength);
        tweets.push(...chunks.slice(0, -1));
        currentTweet = chunks[chunks.length - 1];
      }
    }
  }

  if (currentTweet) {
    tweets.push(currentTweet.trim());
  }

  return tweets;
}

/**
 * Extracts URLs from a given paragraph and replaces them with placeholders.
 *
 * @param {string} paragraph - The paragraph containing URLs that need to be replaced
 * @returns {Object} An object containing the updated text with placeholders and a map of placeholders to original URLs
 */
function extractUrls(paragraph: string): {
  textWithPlaceholders: string;
  placeholderMap: Map<string, string>;
} {
  // replace https urls with placeholder
  const urlRegex = /https?:\/\/[^\s]+/g;
  const placeholderMap = new Map<string, string>();

  let urlIndex = 0;
  const textWithPlaceholders = paragraph.replace(urlRegex, (match) => {
    // twitter url would be considered as 23 characters
    // <<URL_CONSIDERER_23_1>> is also 23 characters
    const placeholder = `<<URL_CONSIDERER_23_${urlIndex}>>`; // Placeholder without . ? ! etc
    placeholderMap.set(placeholder, match);
    urlIndex++;
    return placeholder;
  });

  return { textWithPlaceholders, placeholderMap };
}

/**
 * Splits a given text into chunks based on the specified maximum length while preserving sentence boundaries.
 *
 * @param {string} text - The text to be split into chunks
 * @param {number} maxLength - The maximum length each chunk should not exceed
 *
 * @returns {string[]} An array of chunks where each chunk is within the specified maximum length
 */
function splitSentencesAndWords(text: string, maxLength: number): string[] {
  // Split by periods, question marks and exclamation marks
  // Note that URLs in text have been replaced with `<<URL_xxx>>` and won't be split by dots
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (`${currentChunk} ${sentence}`.trim().length <= maxLength) {
      if (currentChunk) {
        currentChunk += ` ${sentence}`;
      } else {
        currentChunk = sentence;
      }
    } else {
      // Can't fit more, push currentChunk to results
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // If current sentence itself is less than or equal to maxLength
      if (sentence.length <= maxLength) {
        currentChunk = sentence;
      } else {
        // Need to split sentence by spaces
        const words = sentence.split(' ');
        currentChunk = '';
        for (const word of words) {
          if (`${currentChunk} ${word}`.trim().length <= maxLength) {
            if (currentChunk) {
              currentChunk += ` ${word}`;
            } else {
              currentChunk = word;
            }
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          }
        }
      }
    }
  }

  // Handle remaining content
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Deduplicates mentions at the beginning of a paragraph.
 *
 * @param {string} paragraph - The input paragraph containing mentions.
 * @returns {string} - The paragraph with deduplicated mentions.
 */
function deduplicateMentions(paragraph: string) {
  // Regex to match mentions at the beginning of the string
  const mentionRegex = /^@(\w+)(?:\s+@(\w+))*(\s+|$)/;

  // Find all matches
  const matches = paragraph.match(mentionRegex);

  if (!matches) {
    return paragraph; // If no matches, return the original string
  }

  // Extract mentions from the match groups
  let mentions = matches.slice(0, 1)[0].trim().split(' ');

  // Deduplicate mentions
  mentions = Array.from(new Set(mentions));

  // Reconstruct the string with deduplicated mentions
  const uniqueMentionsString = mentions.join(' ');

  // Find where the mentions end in the original string
  const endOfMentions = paragraph.indexOf(matches[0]) + matches[0].length;

  // Construct the result by combining unique mentions with the rest of the string
  return `${uniqueMentionsString} ${paragraph.slice(endOfMentions)}`;
}

/**
 * Restores the original URLs in the chunks by replacing placeholder URLs.
 *
 * @param {string[]} chunks - Array of strings representing chunks of text containing placeholder URLs.
 * @param {Map<string, string>} placeholderMap - Map with placeholder URLs as keys and original URLs as values.
 * @returns {string[]} - Array of strings with original URLs restored in each chunk.
 */
function restoreUrls(chunks: string[], placeholderMap: Map<string, string>): string[] {
  return chunks.map((chunk) => {
    // Replace all <<URL_CONSIDERER_23_>> in chunk back to original URLs using regex
    return chunk.replace(/<<URL_CONSIDERER_23_(\d+)>>/g, (match) => {
      const original = placeholderMap.get(match);
      return original || match; // Return placeholder if not found (theoretically won't happen)
    });
  });
}

/**
 * Splits a paragraph into chunks of text with a maximum length, while preserving URLs.
 *
 * @param {string} paragraph - The paragraph to split.
 * @param {number} maxLength - The maximum length of each chunk.
 * @returns {string[]} An array of strings representing the splitted chunks of text.
 */
function splitParagraph(paragraph: string, maxLength: number): string[] {
  // 1) Extract URLs and replace with placeholders
  const { textWithPlaceholders, placeholderMap } = extractUrls(paragraph);

  // 2) Use first section's logic to split by sentences first, then do secondary split
  const splittedChunks = splitSentencesAndWords(textWithPlaceholders, maxLength);

  // 3) Replace placeholders back to original URLs
  const restoredChunks = restoreUrls(splittedChunks, placeholderMap);

  return restoredChunks;
}

/**
 * Parses the action response from the given text.
 *
 * @param {string} text - The text to parse actions from.
 * @returns {{ actions: ActionResponse }} The parsed actions with boolean values indicating if each action is present in the text.
 */
export const parseActionResponseFromText = (text: string): { actions: ActionResponse } => {
  const actions: ActionResponse = {
    like: false,
    retweet: false,
    quote: false,
    reply: false,
  };

  // Regex patterns
  const likePattern = /\[LIKE\]/i;
  const retweetPattern = /\[RETWEET\]/i;
  const quotePattern = /\[QUOTE\]/i;
  const replyPattern = /\[REPLY\]/i;

  // Check with regex
  actions.like = likePattern.test(text);
  actions.retweet = retweetPattern.test(text);
  actions.quote = quotePattern.test(text);
  actions.reply = replyPattern.test(text);

  // Also do line by line parsing as backup
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[LIKE]') actions.like = true;
    if (trimmed === '[RETWEET]') actions.retweet = true;
    if (trimmed === '[QUOTE]') actions.quote = true;
    if (trimmed === '[REPLY]') actions.reply = true;
  }

  return { actions };
};

/**
 * Generates tweet actions based on the given prompt and model type using the provided runtime.
 * @param {{
 *     runtime: IAgentRuntime;
 *     prompt: string;
 *     modelType: ModelTypeName;
 * }} params - Parameters including the runtime, prompt, and model type.
 * @returns {Promise<ActionResponse | null>} The generated actions or null if no valid response.
 */
export async function generateTweetActions({
  runtime,
  prompt,
  modelType,
}: {
  runtime: IAgentRuntime;
  prompt: string;
  modelType: ModelTypeName;
}): Promise<ActionResponse | null> {
  let retryDelay = 1000;
  while (true) {
    try {
      const response = await runtime.useModel(modelType, {
        prompt,
      });
      logger.debug('Received response from generateText for tweet actions:', response);
      const { actions } = parseActionResponseFromText(response.trim());
      if (actions) {
        logger.debug('Parsed tweet actions:', actions);
        return actions;
      }
      logger.debug('generateTweetActions no valid response');
    } catch (error) {
      logger.error('Error in generateTweetActions:', error);
      if (error instanceof TypeError && error.message.includes('queueTextCompletion')) {
        logger.error("TypeError: Cannot read properties of null (reading 'queueTextCompletion')");
      }
    }
    logger.log(`Retrying in ${retryDelay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
    retryDelay *= 2;
  }
}

/**
 * Generate short filler text via GPT
 */
/**
 * Generates a short filler message for a Twitter Space based on the specified filler type.
 *
 * @param {IAgentRuntime} runtime - The agent runtime instance to use for generating the filler.
 * @param {string} fillerType - The type of filler message to generate.
 * @returns {Promise<string>} The generated filler message as a string.
 */
export async function generateFiller(runtime: IAgentRuntime, fillerType: string): Promise<string> {
  try {
    const prompt = composePrompt({
      state: {
        values: {
          fillerType,
        },
      } as any as State,
      template: `
# INSTRUCTIONS:
You are generating a short filler message for a Twitter Space. The filler type is "{{fillerType}}".
Keep it brief, friendly, and relevant. No more than two sentences.
Only return the text, no additional formatting.

---
`,
    });
    const output = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });
    return output.trim();
  } catch (err) {
    logger.error('[generateFiller] Error generating filler:', err);
    return '';
  }
}

/**
 * Speak a filler message if STT/TTS plugin is available. Sleep a bit after TTS to avoid cutoff.
 */
export async function speakFiller(
  runtime: IAgentRuntime,
  sttTtsPlugin: SttTtsPlugin | undefined,
  fillerType: string,
  sleepAfterMs = 3000
): Promise<void> {
  if (!sttTtsPlugin) return;
  const text = await generateFiller(runtime, fillerType);
  if (!text) return;

  logger.log(`[Space] Filler (${fillerType}) => ${text}`);
  await sttTtsPlugin.speakText(text);

  if (sleepAfterMs > 0) {
    await new Promise((res) => setTimeout(res, sleepAfterMs));
  }
}

/**
 * Generate topic suggestions via GPT if no topics are configured
 */
export async function generateTopicsIfEmpty(runtime: IAgentRuntime): Promise<string[]> {
  try {
    const prompt = composePrompt({
      state: {} as any,
      template: `
# INSTRUCTIONS:
Please generate 5 short topic ideas for a Twitter Space about technology or random interesting subjects.
Return them as a comma-separated list, no additional formatting or numbering.

Example:
"AI Advances, Futuristic Gadgets, Space Exploration, Quantum Computing, Digital Ethics"
---
`,
    });
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });
    const topics = response
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return topics.length ? topics : ['Random Tech Chat', 'AI Thoughts'];
  } catch (err) {
    logger.error('[generateTopicsIfEmpty] GPT error =>', err);
    return ['Random Tech Chat', 'AI Thoughts'];
  }
}

export async function isAgentInSpace(client: ClientBase, spaceId: string): Promise<boolean> {
  const space = await client.twitterClient.getAudioSpaceById(spaceId);
  const agentName = client.state.TWITTER_USERNAME;

  return (
    space.participants.listeners.some(
      (participant) => participant.twitter_screen_name === agentName
    ) ||
    space.participants.speakers.some((participant) => participant.twitter_screen_name === agentName)
  );
}
