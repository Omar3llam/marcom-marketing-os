// ============================================================
// MARCOM / Lumi — Meta Ads MCP Service (The Muscle)
// ------------------------------------------------------------
// Connects to the meta-ads-mcp server via MCP SDK.
// Spawns the MCP server as a child process and communicates
// via stdio transport.
//
// Key Methods:
// - connect() — Spawns MCP server and establishes connection
// - disconnect() — Gracefully closes connection
// - getCampaignInsights() — Fetches campaign data via MCP tools
// - executeAction(toolName, args) — Executes Meta API actions
// ============================================================
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';

class MetaMCPService {
  constructor() {
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }

  /**
   * Spawns the meta-ads-mcp server and establishes connection
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnected) {
      logger.info('[MetaMCP] Already connected');
      return;
    }

    try {
      logger.info('[MetaMCP] Spawning meta-ads-mcp server...');

      // Create stdio transport that spawns the MCP server
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', 'meta-ads-mcp'],
        env: {
          ...process.env,
          META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
        },
      });

      this.client = new Client({
        name: 'lumi-decision-engine',
        version: '4.1.0',
      }, {
        capabilities: {},
      });

      await this.client.connect(this.transport);
      this.isConnected = true;

      logger.info('[MetaMCP] Connected successfully');
    } catch (error) {
      logger.error({ err: error.message }, '[MetaMCP] Failed to connect');
      this.isConnected = false;
      throw new Error(`MCP connection failed: ${error.message}`);
    }
  }

  /**
   * Gracefully disconnects from the MCP server
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.isConnected) return;

    try {
      await this.client?.close();
      this.isConnected = false;
      logger.info('[MetaMCP] Disconnected successfully');
    } catch (error) {
      logger.error({ err: error.message }, '[MetaMCP] Disconnect error');
    }
  }

  /**
   * Fetches campaign insights from Meta Ads API via MCP
   * @param {Object} options - Query options
   * @param {string} options.adAccountId - Meta Ad Account ID (e.g., "act_123456789")
   * @param {string[]} options.fields - Fields to fetch (e.g., ["campaign_name", "spend", "impressions"])
   * @param {string} options.datePreset - Date range (e.g., "last_7d", "last_30d")
   * @returns {Promise<Array>} Array of campaign data
   */
  async getCampaignInsights(options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const {
        adAccountId = process.env.META_AD_ACCOUNT_ID,
        fields = [
          'campaign_id',
          'campaign_name',
          'spend',
          'impressions',
          'clicks',
          'ctr',
          'cpc',
          'cpm',
          'reach',
          'frequency',
          'actions', // conversions
          'cost_per_action_type',
        ],
        datePreset = 'last_7d',
      } = options;

      logger.info({ adAccountId, datePreset }, '[MetaMCP] Fetching campaign insights');

      // Call the MCP tool: get_campaign_insights
      const result = await this.client.callTool({
        name: 'get_campaign_insights',
        arguments: {
          ad_account_id: adAccountId,
          fields: fields.join(','),
          date_preset: datePreset,
        },
      });

      // Parse the result (MCP tools return content array)
      const data = this._parseToolResult(result);

      logger.info({ count: data?.length || 0 }, '[MetaMCP] Campaign insights fetched');
      return data;
    } catch (error) {
      logger.error({ err: error.message }, '[MetaMCP] getCampaignInsights failed');
      throw new Error(`Failed to fetch campaign insights: ${error.message}`);
    }
  }

  /**
   * Executes a Meta API action via MCP tool
   * @param {string} toolName - MCP tool name (e.g., "pause_campaign", "update_budget")
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} Execution result
   */
  async executeAction(toolName, args) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      logger.info({ toolName, args }, '[MetaMCP] Executing action');

      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      const data = this._parseToolResult(result);

      logger.info({ toolName, success: true }, '[MetaMCP] Action executed successfully');
      return {
        success: true,
        data,
      };
    } catch (error) {
      logger.error({ err: error.message, toolName }, '[MetaMCP] Action execution failed');
      throw new Error(`Failed to execute ${toolName}: ${error.message}`);
    }
  }

  /**
   * Lists available MCP tools
   * @returns {Promise<Array>} List of available tools
   */
  async listTools() {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const tools = await this.client.listTools();
      return tools.tools || [];
    } catch (error) {
      logger.error({ err: error.message }, '[MetaMCP] listTools failed');
      return [];
    }
  }

  /**
   * Parses MCP tool result (extracts content from response)
   * @private
   * @param {Object} result - Raw MCP tool result
   * @returns {any} Parsed data
   */
  _parseToolResult(result) {
    if (!result || !result.content) {
      return null;
    }

    // MCP tools return content as an array of content blocks
    // Each block has a type (text, image, etc.) and data
    const textContent = result.content.find(c => c.type === 'text');
    if (!textContent || !textContent.text) {
      return null;
    }

    // Try to parse as JSON (most MCP tools return JSON strings)
    try {
      return JSON.parse(textContent.text);
    } catch {
      // If not JSON, return raw text
      return textContent.text;
    }
  }

  /**
   * Health check - verifies MCP connection and Meta API credentials
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      // Try to list tools as a connection test
      const tools = await this.listTools();

      return {
        status: 'healthy',
        connected: this.isConnected,
        toolsAvailable: tools.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton instance
// NOTE: Signal handlers (SIGTERM/SIGINT) intentionally NOT registered here.
// A module must never own process signals — only the entrypoint (server.js)
// does. Signal handling is wired into server.js shutdown() which calls
// metaMCP.disconnect() in the correct order before closing the HTTP server.
const metaMCP = new MetaMCPService();

export default metaMCP;
