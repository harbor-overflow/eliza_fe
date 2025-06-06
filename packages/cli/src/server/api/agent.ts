import type { Agent, Character, Content, IAgentRuntime, Memory, UUID } from '@elizaos/core';
import {
  ChannelType,
  ModelType,
  composePrompt,
  composePromptFromState,
  createUniqueUuid,
  logger,
  messageHandlerTemplate,
  validateUuid,
  MemoryType,
  encryptStringValue,
  getSalt,
  encryptObjectValues,
} from '@elizaos/core';
import express from 'express';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { AgentServer } from '..';
import { upload } from '../loader';

/**
 * Interface representing a custom request object that extends the express.Request interface.
 * @interface CustomRequest
 * @extends express.Request
 * @property {Express.Multer.File} [file] - Optional property representing a file uploaded with the request
 * @property {Express.Multer.File[]} [files] - Optional property representing multiple files uploaded with the request
 * @property {Object} params - Object representing parameters included in the request
 * @property {string} params.agentId - The unique identifier for the agent associated with the request
 * @property {string} [params.knowledgeId] - Optional knowledge ID parameter
 */
interface CustomRequest extends express.Request {
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
  params: {
    agentId: string;
    knowledgeId?: string;
  };
}

/**
 * Creates an express Router for handling agent-related routes.
 *
 * @param agents - Map of UUID to agent runtime instances.
 * @param server - Optional AgentServer instance.
 * @returns An express Router for agent routes.
 */
export function agentRouter(
  agents: Map<UUID, IAgentRuntime>,
  server?: AgentServer
): express.Router {
  const router = express.Router();
  const db = server?.database;

  // List all agents
  router.get('/', async (_, res) => {
    try {
      const allAgents = await db.getAgents();

      // find running agents
      const runtimes = Array.from(agents.keys());

      // returns minimal agent data
      const response = allAgents
        .map((agent: Agent) => ({
          ...agent,
          status: runtimes.includes(agent.id) ? 'active' : 'inactive',
        }))
        .sort((a: any, b: any) => {
          if (a.status === b.status) {
            return a.name.localeCompare(b.name);
          }
          return a.status === 'active' ? -1 : 1;
        });

      res.json({
        success: true,
        data: { agents: response },
      });
    } catch (error) {
      logger.error('[AGENTS LIST] Error retrieving agents:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 500,
          message: 'Error retrieving agents',
          details: error.message,
        },
      });
    }
  });

  // Get specific agent details
  router.get('/:agentId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    try {
      const agent = await db.getAgent(agentId);
      if (!agent) {
        logger.debug('[AGENT GET] Agent not found');
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Agent not found',
          },
        });
        return;
      }

      const runtime = agents.get(agentId);

      // check if agent is running
      const status = runtime ? 'active' : 'inactive';

      res.json({
        success: true,
        data: { ...agent, status },
      });
    } catch (error) {
      logger.error('[AGENT GET] Error getting agent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 500,
          message: 'Error getting agent',
          details: error.message,
        },
      });
    }
  });

  // Create new agent
  router.post('/', async (req, res) => {
    logger.debug('[AGENT CREATE] Creating new agent');
    const { characterPath, characterJson } = req.body;

    try {
      let character: Character;

      if (characterJson) {
        logger.debug('[AGENT CREATE] Parsing character from JSON');
        character = await server?.jsonToCharacter(characterJson);
      } else if (characterPath) {
        logger.debug(`[AGENT CREATE] Loading character from path: ${characterPath}`);
        character = await server?.loadCharacterTryPath(characterPath);
      } else {
        throw new Error('No character configuration provided');
      }

      if (!character) {
        throw new Error('Failed to create character configuration');
      }

      // Encrypt secrets if they exist in the character
      if (character.settings?.secrets) {
        logger.debug('[AGENT CREATE] Encrypting secrets');
        const salt = getSalt();
        character.settings.secrets = encryptObjectValues(character.settings.secrets, salt);
      }

      await db.ensureAgentExists(character);

      res.status(201).json({
        success: true,
        data: {
          character: character,
        },
      });
      logger.success(`[AGENT CREATE] Successfully created agent: ${character.name}`);
    } catch (error) {
      logger.error('[AGENT CREATE] Error creating agent:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: 'Error creating agent',
          details: error.message,
        },
      });
    }
  });

  // Update agent
  router.patch('/:agentId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const updates = req.body;

    try {
      // Handle encryption of secrets if present in updates
      if (updates.settings?.secrets) {
        const salt = getSalt();
        const encryptedSecrets: Record<string, string> = {};

        // Encrypt each secret value
        // We need to handle null values separately
        // because they mean delete the secret
        Object.entries(updates.settings.secrets).forEach(([key, value]) => {
          if (value === null) {
            // Null means delete the secret
            encryptedSecrets[key] = null;
          } else if (typeof value === 'string') {
            // Only encrypt string values
            encryptedSecrets[key] = encryptStringValue(value, salt);
          } else {
            // Leave other types as is
            encryptedSecrets[key] = value as string;
          }
        });

        // Replace with encrypted secrets
        updates.settings.secrets = encryptedSecrets;
      }

      // Handle other updates if any
      if (Object.keys(updates).length > 0) {
        await db.updateAgent(agentId, updates);
      }

      const updatedAgent = await db.getAgent(agentId);

      const isActive = !!agents.get(agentId);
      if (isActive) {
        // stop existing runtime
        server?.unregisterAgent(agentId);
        // start new runtime
        await server?.startAgent(updatedAgent);
      }

      // check if agent got started successfully
      const runtime = agents.get(agentId);
      const status = runtime ? 'active' : 'inactive';

      res.json({
        success: true,
        data: { ...updatedAgent, status },
      });
    } catch (error) {
      logger.error('[AGENT UPDATE] Error updating agent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: 'Error updating agent',
          details: error.message,
        },
      });
    }
  });

  // Stop an existing agent
  router.put('/:agentId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      logger.debug('[AGENT STOP] Invalid agent ID format');
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    // get agent runtime
    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    // stop existing runtime
    server?.unregisterAgent(agentId);

    // return success
    res.json({
      success: true,
      data: {
        message: 'Agent stopped',
      },
    });
  });

  // Start an existing agent
  router.post('/:agentId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    try {
      // Check if agent exists
      const agent = await db.getAgent(agentId);

      if (!agent) {
        logger.debug('[AGENT START] Agent not found');
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Agent not found',
          },
        });
        return;
      }

      const isActive = !!agents.get(agentId);

      // Check if agent is already running
      if (isActive) {
        logger.debug(`[AGENT START] Agent ${agentId} is already running`);
        res.json({
          success: true,
          data: {
            id: agentId,
            name: agent.name,
            status: 'active',
          },
        });
        return;
      }

      // Start the agent
      await server?.startAgent(agent);

      // Verify agent started successfully
      const runtime = agents.get(agentId);
      if (!runtime) {
        throw new Error('Failed to start agent');
      }

      logger.debug(`[AGENT START] Successfully started agent: ${agent.name}`);
      res.json({
        success: true,
        data: {
          id: agentId,
          name: agent.name,
          status: 'active',
        },
      });
    } catch (error) {
      logger.error('[AGENT START] Error starting agent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'START_ERROR',
          message: 'Error starting agent',
          details: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  // Delete agent
  router.delete('/:agentId', async (req, res) => {
    logger.debug(`[AGENT DELETE] Received request to delete agent with ID: ${req.params.agentId}`);

    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      logger.error(`[AGENT DELETE] Invalid agent ID format: ${req.params.agentId}`);
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    logger.debug(`[AGENT DELETE] Validated agent ID: ${agentId}, proceeding with deletion`);

    // First, check if agent exists
    try {
      const agent = await db.getAgent(agentId);
      if (!agent) {
        logger.warn(`[AGENT DELETE] Agent not found: ${agentId}`);
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Agent not found',
          },
        });
        return;
      }

      logger.debug(`[AGENT DELETE] Agent found: ${agent.name} (${agentId})`);
    } catch (checkError) {
      logger.error(`[AGENT DELETE] Error checking if agent exists: ${agentId}`, checkError);
      // Continue with deletion attempt anyway
    }

    // Set a timeout to send a response if the operation takes too long
    const timeoutId = setTimeout(() => {
      logger.warn(`[AGENT DELETE] Operation taking longer than expected for agent: ${agentId}`);
      res.status(202).json({
        success: true,
        partial: true,
        message:
          'Agent deletion initiated but taking longer than expected. The operation will continue in the background.',
      });
    }, 10000);

    const MAX_RETRIES = 2;
    let retryCount = 0;
    let lastError = null;

    // Retry loop for database operations
    while (retryCount <= MAX_RETRIES) {
      try {
        // First, if the agent is running, stop it immediately to prevent ongoing operations
        const runtime = agents.get(agentId);
        if (runtime) {
          logger.debug(`[AGENT DELETE] Agent ${agentId} is running, unregistering from server`);
          try {
            server?.unregisterAgent(agentId);
            logger.debug(`[AGENT DELETE] Agent ${agentId} unregistered successfully`);
          } catch (stopError) {
            logger.error(`[AGENT DELETE] Error stopping agent ${agentId}:`, stopError);
            // Continue with deletion even if stopping fails
          }
        } else {
          logger.debug(`[AGENT DELETE] Agent ${agentId} was not running, no need to unregister`);
        }

        logger.debug(`[AGENT DELETE] Calling database deleteAgent method for agent: ${agentId}`);

        // Perform the deletion operation
        const deleteResult = await db.deleteAgent(agentId);
        logger.debug(`[AGENT DELETE] Database deleteAgent result: ${JSON.stringify(deleteResult)}`);

        // Clear the response timeout since we completed before it triggered
        clearTimeout(timeoutId);

        logger.success(`[AGENT DELETE] Successfully deleted agent: ${agentId}`);

        // Only send response if one hasn't been sent already
        if (!res.headersSent) {
          res.status(204).send();
        }

        // Successfully deleted, break out of retry loop
        return;
      } catch (error) {
        lastError = error;
        retryCount++;

        logger.error(
          `[AGENT DELETE] Error deleting agent ${agentId} (attempt ${retryCount}/${MAX_RETRIES + 1}):`,
          error
        );

        // If we've reached max retries, break out of the loop
        if (retryCount > MAX_RETRIES) {
          break;
        }

        // Wait a bit before retrying
        const delay = 1000 * Math.pow(2, retryCount - 1); // Exponential backoff
        logger.debug(`[AGENT DELETE] Waiting ${delay}ms before retry ${retryCount}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Clear the response timeout
    clearTimeout(timeoutId);

    // If we reach here, all retries failed
    // Check if headers have already been sent (from the timeout handler)
    if (!res.headersSent) {
      let statusCode = 500;
      let errorMessage = 'Error deleting agent';

      // Special handling for different error types
      if (lastError instanceof Error) {
        const message = lastError.message;

        if (message.includes('foreign key constraint')) {
          errorMessage = 'Cannot delete agent because it has active references in the system';
          statusCode = 409; // Conflict
        } else if (message.includes('timed out')) {
          errorMessage = 'Agent deletion operation timed out';
          statusCode = 408; // Request Timeout
        }
      }

      res.status(statusCode).json({
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: errorMessage,
          details: lastError instanceof Error ? lastError.message : String(lastError),
        },
      });
    }
  });

  // Delete Memory
  router.delete('/:agentId/memories/:memoryId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    const memoryId = validateUuid(req.params.memoryId);

    if (!agentId || !memoryId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID or memory ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    await runtime.deleteMemory(memoryId);

    res.status(204).send();
  });

  // Get Agent Logs
  router.get('/:agentId/logs', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    const { roomId, type, count, offset } = req.query;
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    if (roomId) {
      const roomIdValidated = validateUuid(roomId);
      if (!roomIdValidated) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid room ID format',
          },
        });
        return;
      }
    }

    const logs = await runtime.getLogs({
      entityId: agentId,
      roomId: roomId ? (roomId as UUID) : undefined,
      type: type ? (type as string) : undefined,
      count: count ? Number(count) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json({
      success: true,
      data: logs,
    });
  });

  router.delete('/:agentId/logs/:logId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    const logId = validateUuid(req.params.logId);
    if (!agentId || !logId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent or log ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    await runtime.deleteLog(logId);

    res.status(204).send();
  });

  // Audio messages endpoints
  router.post(
    '/:agentId/audio-messages',
    upload.single('file'),
    async (req: CustomRequest, res) => {
      logger.debug('[AUDIO MESSAGE] Processing audio message');
      const agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid agent ID format',
          },
        });
        return;
      }

      const audioFile = req.file;
      if (!audioFile) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'No audio file provided',
          },
        });
        return;
      }

      const runtime = agents.get(agentId);

      if (!runtime) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Agent not found',
          },
        });
        return;
      }

      try {
        const audioBuffer = fs.readFileSync(audioFile.path);
        const transcription = await runtime.useModel(ModelType.TRANSCRIPTION, audioBuffer);

        // Process the transcribed text as a message
        const messageRequest = {
          ...req,
          body: {
            ...req.body,
            text: transcription,
          },
        };

        // Reuse the message endpoint logic
        await this.post('/:agentId/messages')(messageRequest, res);
      } catch (error) {
        logger.error('[AUDIO MESSAGE] Error processing audio:', error);
        res.status(500).json({
          success: false,
          error: {
            code: 'PROCESSING_ERROR',
            message: 'Error processing audio message',
            details: error.message,
          },
        });
      }
    }
  );

  // Text-to-Speech endpoint
  router.post('/:agentId/audio-messages/synthesize', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const { text } = req.body;
    if (!text) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Text is required for speech synthesis',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);

    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      const speechResponse = await runtime.useModel(ModelType.TEXT_TO_SPEECH, text);

      // Convert to Buffer if not already a Buffer
      const audioBuffer = Buffer.isBuffer(speechResponse)
        ? speechResponse
        : await new Promise<Buffer>((resolve, reject) => {
            if (!(speechResponse instanceof Readable)) {
              return reject(new Error('Unexpected response type from TEXT_TO_SPEECH model'));
            }

            const chunks: Buffer[] = [];
            speechResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            speechResponse.on('end', () => resolve(Buffer.concat(chunks)));
            speechResponse.on('error', (err) => reject(err));
          });

      logger.debug('[TTS] Setting response headers');
      res.set({
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      });

      res.send(Buffer.from(audioBuffer));
    } catch (error) {
      logger.error('[TTS] Error generating speech:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Error generating speech',
          details: error.message,
        },
      });
    }
  });

  // Speech-related endpoints
  router.post('/:agentId/speech/generate', async (req, res) => {
    logger.debug('[SPEECH GENERATE] Request to generate speech from text');
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const { text } = req.body;
    if (!text) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Text is required for speech synthesis',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);

    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      logger.debug('[SPEECH GENERATE] Using text-to-speech model');
      const speechResponse = await runtime.useModel(ModelType.TEXT_TO_SPEECH, text);

      // Convert to Buffer if not already a Buffer
      const audioBuffer = Buffer.isBuffer(speechResponse)
        ? speechResponse
        : await new Promise<Buffer>((resolve, reject) => {
            if (
              !(speechResponse instanceof Readable) &&
              !(
                speechResponse &&
                speechResponse.readable === true &&
                typeof speechResponse.pipe === 'function' &&
                typeof speechResponse.on === 'function'
              )
            ) {
              return reject(new Error('Unexpected response type from TEXT_TO_SPEECH model'));
            }

            const chunks: Buffer[] = [];
            speechResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            speechResponse.on('end', () => resolve(Buffer.concat(chunks)));
            speechResponse.on('error', (err) => reject(err));
          });

      logger.debug('[SPEECH GENERATE] Setting response headers');
      res.set({
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      });

      res.send(Buffer.from(audioBuffer));
      logger.success(
        `[SPEECH GENERATE] Successfully generated speech for: ${runtime.character.name}`
      );
    } catch (error) {
      logger.error('[SPEECH GENERATE] Error generating speech:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Error generating speech',
          details: error.message,
        },
      });
    }
  });

  router.post('/:agentId/speech/conversation', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const { text, roomId: rawRoomId, entityId: rawUserId } = req.body;
    if (!text) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Text is required for conversation',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);

    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      const roomId = createUniqueUuid(runtime, rawRoomId ?? `default-room-${agentId}`);
      const entityId = createUniqueUuid(runtime, rawUserId ?? 'Anon');

      logger.debug('[SPEECH CONVERSATION] Ensuring connection');
      await runtime.ensureConnection({
        entityId,
        roomId,
        userName: req.body.userName,
        name: req.body.name,
        source: 'direct',
        type: ChannelType.API,
      });

      const messageId = createUniqueUuid(runtime, Date.now().toString());
      const content: Content = {
        text,
        attachments: [],
        source: 'direct',
        inReplyTo: undefined,
        channelType: ChannelType.API,
      };

      const userMessage = {
        content,
        entityId,
        roomId,
        agentId: runtime.agentId,
      };

      const memory: Memory = {
        id: messageId,
        agentId: runtime.agentId,
        entityId,
        roomId,
        content,
        createdAt: Date.now(),
      };

      logger.debug('[SPEECH CONVERSATION] Creating memory');
      await runtime.createMemory(memory, 'messages');

      logger.debug('[SPEECH CONVERSATION] Composing state');
      const state = await runtime.composeState(userMessage);

      logger.debug('[SPEECH CONVERSATION] Creating context');
      const prompt = composePrompt({
        state,
        template: messageHandlerTemplate,
      });

      logger.debug('[SPEECH CONVERSATION] Using LLM for response');
      const response = await runtime.useModel(ModelType.TEXT_LARGE, {
        messages: [
          {
            role: 'system',
            content: messageHandlerTemplate,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      if (!response) {
        res.status(500).json({
          success: false,
          error: {
            code: 'MODEL_ERROR',
            message: 'No response from model',
          },
        });
        return;
      }

      logger.debug('[SPEECH CONVERSATION] Creating response memory');

      const responseMessage = {
        ...userMessage,
        content: { text: response },
        roomId: roomId as UUID,
        agentId: runtime.agentId,
      };

      await runtime.createMemory(responseMessage, 'messages');
      await runtime.evaluate(memory, state);

      await runtime.processActions(memory, [responseMessage as Memory], state, async () => [
        memory,
      ]);

      logger.debug('[SPEECH CONVERSATION] Generating speech response');

      const speechResponse = await runtime.useModel(ModelType.TEXT_TO_SPEECH, text);

      // Convert to Buffer if not already a Buffer
      const audioBuffer = Buffer.isBuffer(speechResponse)
        ? speechResponse
        : await new Promise<Buffer>((resolve, reject) => {
            if (!(speechResponse instanceof Readable)) {
              return reject(new Error('Unexpected response type from TEXT_TO_SPEECH model'));
            }

            const chunks: Buffer[] = [];
            speechResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            speechResponse.on('end', () => resolve(Buffer.concat(chunks)));
            speechResponse.on('error', (err) => reject(err));
          });

      logger.debug('[SPEECH CONVERSATION] Setting response headers');

      res.set({
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      });

      res.send(Buffer.from(audioBuffer));

      logger.success(
        `[SPEECH CONVERSATION] Successfully processed conversation for: ${runtime.character.name}`
      );
    } catch (error) {
      logger.error('[SPEECH CONVERSATION] Error processing conversation:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Error processing conversation',
          details: error.message,
        },
      });
    }
  });

  router.post(
    '/:agentId/transcriptions',
    upload.single('file'),
    async (req: CustomRequest, res) => {
      logger.debug('[TRANSCRIPTION] Request to transcribe audio');
      const agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid agent ID format',
          },
        });
        return;
      }

      const audioFile = req.file;
      if (!audioFile) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'No audio file provided',
          },
        });
        return;
      }

      const runtime = agents.get(agentId);

      if (!runtime) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Agent not found',
          },
        });
        return;
      }

      try {
        logger.debug('[TRANSCRIPTION] Reading audio file');
        const audioBuffer = fs.readFileSync(audioFile.path);

        logger.debug('[TRANSCRIPTION] Transcribing audio');
        const transcription = await runtime.useModel(ModelType.TRANSCRIPTION, audioBuffer);

        // Clean up the temporary file
        fs.unlinkSync(audioFile.path);

        if (!transcription) {
          res.status(500).json({
            success: false,
            error: {
              code: 'PROCESSING_ERROR',
              message: 'Failed to transcribe audio',
            },
          });
          return;
        }

        logger.success('[TRANSCRIPTION] Successfully transcribed audio');
        res.json({
          success: true,
          data: {
            text: transcription,
          },
        });
      } catch (error) {
        logger.error('[TRANSCRIPTION] Error transcribing audio:', error);
        // Clean up the temporary file in case of error
        if (audioFile.path && fs.existsSync(audioFile.path)) {
          fs.unlinkSync(audioFile.path);
        }

        res.status(500).json({
          success: false,
          error: {
            code: 'PROCESSING_ERROR',
            message: 'Error transcribing audio',
            details: error.message,
          },
        });
      }
    }
  );

  // Get memories for a specific room
  router.get('/:agentId/rooms/:roomId/memories', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    const roomId = validateUuid(req.params.roomId);

    if (!agentId || !roomId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID or room ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);

    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 20;
      const before = req.query.before
        ? Number.parseInt(req.query.before as string, 10)
        : Date.now();
      const _worldId = req.query.worldId as string;

      const memories = await runtime.getMemories({
        tableName: 'messages',
        roomId,
        count: limit,
        end: before,
      });

      const cleanMemories = memories.map((memory) => {
        return {
          ...memory,
          embedding: undefined,
        };
      });

      res.json({
        success: true,
        data: {
          memories: cleanMemories,
        },
      });
    } catch (error) {
      logger.error('[MEMORIES GET] Error retrieving memories for room:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 500,
          message: 'Failed to retrieve memories',
          details: error.message,
        },
      });
    }
  });

  router.post('/:agentId/message', async (req: CustomRequest, res) => {
    logger.debug('[MESSAGES CREATE] Creating new message');
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    // get runtime
    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    const entityId = req.body.entityId;
    const roomId = req.body.roomId;

    const source = req.body.source;
    const text = req.body.text.trim();

    const channelType = req.body.channelType;

    try {
      const messageId = createUniqueUuid(runtime, Date.now().toString());

      const content: Content = {
        text,
        attachments: [],
        source,
        inReplyTo: undefined,
        channelType: channelType || ChannelType.API,
      };

      const userMessage = {
        content,
        entityId,
        roomId,
        agentId: runtime.agentId,
      };

      const memory: Memory = {
        id: createUniqueUuid(runtime, messageId),
        ...userMessage,
        agentId: runtime.agentId,
        entityId,
        roomId,
        content,
        createdAt: Date.now(),
      };

      // save message
      await runtime.createMemory(memory, 'messages');

      let state = await runtime.composeState(memory);

      const prompt = composePromptFromState({
        state,
        template: messageHandlerTemplate,
      });

      const response = await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt,
      });

      if (!response) {
        res.status(500).json({
          success: false,
          error: {
            code: 'MODEL_ERROR',
            message: 'No response from model',
          },
        });
        return;
      }

      const responseMessage: Memory = {
        id: createUniqueUuid(runtime, messageId),
        ...userMessage,
        entityId: runtime.agentId,
        content: response,
        createdAt: Date.now(),
      };

      const replyHandler = async (message: Content) => {
        res.status(201).json({
          success: true,
          data: {
            message,
            messageId,
            name: runtime.character.name,
            roomId: req.body.roomId,
            source,
          },
        });
        return [memory];
      };

      await runtime.processActions(memory, [responseMessage], state, replyHandler);

      await runtime.evaluate(memory, state);

      if (!res.headersSent) {
        res.status(202).json();
      }
    } catch (error) {
      logger.error('Error processing message:', error.message);
      res.status(500).json({
        success: false,
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Error processing message',
          details: error.message,
        },
      });
    }
  });

  // get all memories for an agent
  router.get('/:agentId/memories', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    // Get tableName from query params, default to "messages"
    const tableName = (req.query.tableName as string) || 'messages';

    const memories = await runtime.getMemories({
      agentId,
      tableName,
    });

    const cleanMemories = memories.map((memory) => {
      return {
        ...memory,
        embedding: undefined,
      };
    });

    res.json({
      success: true,
      data: cleanMemories,
    });
  });

  // create a new memory for an agent
  router.post('/:agentId/memories', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      const memoryData = req.body;

      // 필수 필드 확인
      if (!memoryData.content) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MEMORY',
            message: 'Memory content is required',
          },
        });
        return;
      }

      // ID가 없는 경우 생성
      if (!memoryData.id) {
        memoryData.id = createUniqueUuid(runtime, `memory-${Date.now()}`);
      }

      // 에이전트 ID 설정
      memoryData.agentId = agentId;

      // 타임스탬프 설정
      if (!memoryData.createdAt) {
        memoryData.createdAt = Date.now();
      }

      // 테이블 이름 가져오기 (기본값: messages)
      const tableName = (req.query.tableName as string) || 'messages';

      // 메모리 생성
      await runtime.createMemory(memoryData, tableName);

      logger.success(`[MEMORY CREATE] Successfully created memory ${memoryData.id}`);
      res.status(201).json({
        success: true,
        data: {
          id: memoryData.id,
          message: 'Memory created successfully',
        },
      });
    } catch (error) {
      logger.error('[MEMORY CREATE] Error creating memory:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: 'Failed to create memory',
          details: error.message,
        },
      });
    }
  });

  // update a specific memory for an agent
  router.patch('/:agentId/memories/:memoryId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    const memoryId = validateUuid(req.params.memoryId);

    const memory = req.body;

    if (!agentId || !memoryId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID or memory ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    try {
      // Ensure memory has the correct ID from the path
      const memoryToUpdate = {
        ...memory,
        id: memoryId,
      };

      await runtime.updateMemory(memoryToUpdate);

      logger.success(`[MEMORY UPDATE] Successfully updated memory ${memoryId}`);
      res.json({
        success: true,
        data: {
          id: memoryId,
          message: 'Memory updated successfully',
        },
      });
    } catch (error) {
      logger.error(`[MEMORY UPDATE] Error updating memory ${memoryId}:`, error);
      res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: 'Failed to update memory',
          details: error.message,
        },
      });
    }
  });

  // Knowledge management routes
  router.post('/:agentId/memories/upload-knowledge', upload.array('files'), async (req, res) => {
    const agentId = validateUuid(req.params.agentId);

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid agent ID format',
        },
      });
      return;
    }

    const runtime = agents.get(agentId);

    if (!runtime) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
      return;
    }

    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILES',
          message: 'No files uploaded',
        },
      });
      return;
    }

    try {
      const results = [];

      for (const file of files) {
        try {
          // Read file content
          const content = fs.readFileSync(file.path, 'utf8');

          // Format the content with Path: prefix like in the devRel/index.ts example
          const relativePath = file.originalname;
          const formattedContent = `Path: ${relativePath}\n\n${content}`;

          // Create knowledge item with proper metadata
          const knowledgeId = createUniqueUuid(runtime, `knowledge-${Date.now()}`);
          const fileExt = file.originalname.split('.').pop()?.toLowerCase() || '';
          const filename = file.originalname;
          const title = filename.replace(`.${fileExt}`, '');

          const knowledgeItem = {
            id: knowledgeId,
            content: {
              text: formattedContent,
            },
            metadata: {
              type: MemoryType.DOCUMENT,
              timestamp: Date.now(),
              filename: filename,
              fileExt: fileExt,
              title: title,
              path: relativePath,
              fileType: file.mimetype,
              fileSize: file.size,
              source: 'upload',
            },
          };

          // Add knowledge to agent
          await runtime.addKnowledge(knowledgeItem, {
            targetTokens: 1500,
            overlap: 200,
            modelContextSize: 4096,
          });

          // Clean up temp file immediately after successful processing
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }

          results.push({
            id: knowledgeId,
            filename: relativePath,
            type: file.mimetype,
            size: file.size,
            uploadedAt: Date.now(),
            preview:
              formattedContent.length > 0
                ? `${formattedContent.substring(0, 150)}${formattedContent.length > 150 ? '...' : ''}`
                : 'No preview available',
          });
        } catch (fileError) {
          logger.error(`[KNOWLEDGE POST] Error processing file ${file.originalname}: ${fileError}`);
          // Clean up this file if it exists
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
          // Continue with other files even if one fails
        }
      }

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error(`[KNOWLEDGE POST] Error uploading knowledge: ${error}`);

      // Clean up any remaining files
      if (files) {
        for (const file of files) {
          if (file.path && fs.existsSync(file.path)) {
            try {
              fs.unlinkSync(file.path);
            } catch (cleanupError) {
              logger.error(
                `[KNOWLEDGE POST] Error cleaning up file ${file.originalname}: ${cleanupError}`
              );
            }
          }
        }
      }

      res.status(500).json({
        success: false,
        error: {
          code: 500,
          message: 'Failed to upload knowledge',
          details: error.message,
        },
      });
    }
  });

  router.post('/groups/:serverId', async (req, res) => {
    const serverId = validateUuid(req.params.serverId);

    const { name, worldId, source, metadata, agentIds = [] } = req.body;

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'agentIds must be a non-empty array',
        },
      });
    }

    let results = [];
    let errors = [];

    for (const agentId of agentIds) {
      const runtime = agents.get(agentId);

      if (!runtime) {
        errors.push({
          agentId,
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
        continue;
      }

      try {
        const roomId = createUniqueUuid(runtime, serverId);
        const roomName = name || `Chat ${new Date().toLocaleString()}`;

        await runtime.ensureWorldExists({
          id: worldId,
          name: source,
          agentId: runtime.agentId,
          serverId: serverId,
        });

        await runtime.ensureRoomExists({
          id: roomId,
          name: roomName,
          source,
          type: ChannelType.API,
          worldId,
          serverId,
          metadata,
        });

        await runtime.addParticipant(runtime.agentId, roomId);
        await runtime.ensureParticipantInRoom(runtime.agentId, roomId);
        await runtime.setParticipantUserState(roomId, runtime.agentId, 'FOLLOWED');

        results.push({
          id: roomId,
          name: roomName,
          createdAt: Date.now(),
          source: 'client',
          worldId,
        });
      } catch (error) {
        logger.error(`[ROOM CREATE] Error creating room for agent ${agentId}:`, error);
        errors.push({
          agentId,
          code: 'CREATE_ERROR',
          message: 'Failed to create room',
          details: error.message,
        });
      }
    }

    if (results.length === 0) {
      res.status(500).json({
        success: false,
        error: errors.length
          ? errors
          : [{ code: 'UNKNOWN_ERROR', message: 'No rooms were created' }],
      });
    }

    res.status(errors.length ? 207 : 201).json({
      success: errors.length === 0,
      data: results,
      errors: errors.length ? errors : undefined,
    });
  });

  router.delete('/groups/:serverId', async (req, res) => {
    const serverId = validateUuid(req.params.serverId);
    try {
      await db.deleteRoomsByServerId(serverId);

      res.status(204).send();
    } catch (error) {
      logger.error('[GROUP DELETE] Error deleting group:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: 'Error deleting group',
          details: error.message,
        },
      });
    }
  });

  return router;
}
