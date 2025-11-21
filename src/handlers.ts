import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import { ToolName } from './tools';
import {
  SendCommandToElectronSchema,
  TakeScreenshotSchema,
  ReadElectronLogsSchema,
  GetElectronWindowInfoSchema,
} from './schemas';
import { sendCommandToElectron } from './utils/electron-enhanced-commands';
import { collectPerformanceSnapshot, runAutomationScript } from './utils/electron-enhanced-commands';
import { getElectronWindowInfo } from './utils/electron-discovery';
import { readElectronLogs } from './utils/electron-logs';
import { takeScreenshot } from './screenshot';
import { logger } from './utils/logger';
import { securityManager } from './security/manager';
import { runDevToolsTrace } from './utils/devtools-tracing';
import { captureNetworkSnapshot } from './utils/devtools-network';

export async function handleToolCall(request: z.infer<typeof CallToolRequestSchema>) {
  const { name, arguments: args } = request.params;

  // Extract request metadata for security logging
  const sourceIP = (request as any).meta?.sourceIP;
  const userAgent = (request as any).meta?.userAgent;

  try {
    switch (name) {
      case ToolName.GET_ELECTRON_WINDOW_INFO: {
        // This is a low-risk read operation - basic validation only
        const { includeChildren } = GetElectronWindowInfoSchema.parse(args);

        const securityResult = await securityManager.executeSecurely({
          command: 'get_window_info',
          args,
          sourceIP,
          userAgent,
          operationType: 'window_info',
        });

        if (securityResult.blocked) {
          return {
            content: [
              {
                type: 'text',
                text: `Operation blocked: ${securityResult.error}`,
              },
            ],
            isError: true,
          };
        }

        const result = await getElectronWindowInfo(includeChildren);
        return {
          content: [
            {
              type: 'text',
              text: `Window Information:\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
          isError: false,
        };
      }

      case ToolName.TAKE_SCREENSHOT: {
        // Security check for screenshot operation
        const securityResult = await securityManager.executeSecurely({
          command: 'take_screenshot',
          args,
          sourceIP,
          userAgent,
          operationType: 'screenshot',
        });

        if (securityResult.blocked) {
          return {
            content: [
              {
                type: 'text',
                text: `Screenshot blocked: ${securityResult.error}`,
              },
            ],
            isError: true,
          };
        }
        const { outputPath, windowTitle } = TakeScreenshotSchema.parse(args);
        const result = await takeScreenshot(outputPath, windowTitle);

        // Return the screenshot as base64 data for AI to evaluate
        const content: any[] = [];

        if (result.filePath) {
          content.push({
            type: 'text',
            text: `Screenshot saved to: ${result.filePath}`,
          });
        } else {
          content.push({
            type: 'text',
            text: 'Screenshot captured in memory (no file saved)',
          });
        }

        // Add the image data for AI evaluation
        content.push({
          type: 'image',
          data: result.base64!,
          mimeType: 'image/png',
        });

        return { content, isError: false };
      }

      case ToolName.SEND_COMMAND_TO_ELECTRON: {
        const { command, args: commandArgs } = SendCommandToElectronSchema.parse(args);

        // Execute command through security manager
        const securityResult = await securityManager.executeSecurely({
          command,
          args: commandArgs,
          sourceIP,
          userAgent,
          operationType: 'command',
        });

        if (securityResult.blocked) {
          return {
            content: [
              {
                type: 'text',
                text: `Command blocked: ${securityResult.error}\nRisk Level: ${securityResult.riskLevel}`,
              },
            ],
            isError: true,
          };
        }

        if (!securityResult.success) {
          return {
            content: [
              {
                type: 'text',
                text: `Command failed: ${securityResult.error}`,
              },
            ],
            isError: true,
          };
        }

        // Execute the actual command if security checks pass
        const result = await sendCommandToElectron(command, commandArgs);
        return {
          content: [{ type: 'text', text: result }],
          isError: false,
        };
      }

      case ToolName.RUN_PERFORMANCE_SNAPSHOT: {
        const { includeResources, includeNavigation, collectConsoleErrors, captureScreenshot, outputPath, windowTitle, metricsOnly, includeWebVitals } = (args as any) || {};
        const securityResult = await securityManager.executeSecurely({
          command: 'run_performance_snapshot',
          args,
          sourceIP,
          userAgent,
          operationType: 'diagnostic',
        });
        if (securityResult.blocked) {
          return { content: [{ type: 'text', text: `Operation blocked: ${securityResult.error}` }], isError: true };
        }
        const snapshot = await collectPerformanceSnapshot({ includeResources, includeNavigation, collectConsoleErrors, captureScreenshot, outputPath, windowTitle, includeWebVitals });
        const content: any[] = [{ type: 'text', text: `Performance Snapshot:\n\n${snapshot.report}` }];
        if (snapshot.screenshotBase64 && !metricsOnly) {
          content.push({ type: 'image', data: snapshot.screenshotBase64, mimeType: 'image/png' });
        }
        return { content, isError: false };
      }

      case ToolName.RUN_AUTOMATION_SCRIPT: {
        const { steps, preScreenshot, postScreenshot, outputPath, windowTitle, includeLogs, logLines, usePlaywright } = (args as any) || {};
        const securityResult = await securityManager.executeSecurely({
          command: 'run_automation_script',
          args,
          sourceIP,
          userAgent,
          operationType: 'command',
        });
        if (securityResult.blocked) {
          return { content: [{ type: 'text', text: `Operation blocked: ${securityResult.error}` }], isError: true };
        }
        const result = await runAutomationScript(steps || [], { preScreenshot, postScreenshot, outputPath, windowTitle, includeLogs, logLines, usePlaywright });
        const content: any[] = [{ type: 'text', text: `Automation Script Result:\n\n${result.summary}` }];
        if (result.preShot) content.push({ type: 'image', data: result.preShot, mimeType: 'image/png' });
        if (result.postShot) content.push({ type: 'image', data: result.postShot, mimeType: 'image/png' });
        return { content, isError: false };
      }

      case ToolName.RUN_DEVTOOLS_TRACE: {
        const { durationMs, categories } = (args as any) || {};
        const securityResult = await securityManager.executeSecurely({
          command: 'run_devtools_trace',
          args,
          sourceIP,
          userAgent,
          operationType: 'diagnostic',
        });
        if (securityResult.blocked) {
          return { content: [{ type: 'text', text: `Operation blocked: ${securityResult.error}` }], isError: true };
        }
        const report = await runDevToolsTrace({ durationMs, categories });
        return { content: [{ type: 'text', text: `DevTools Trace Summary:\n\n${report}` }], isError: false };
      }

      case ToolName.CAPTURE_NETWORK_SNAPSHOT: {
        const { durationMs, idleMs, maxRequests, includeFailures } = (args as any) || {};
        const securityResult = await securityManager.executeSecurely({
          command: 'capture_network_snapshot',
          args,
          sourceIP,
          userAgent,
          operationType: 'diagnostic',
        });
        if (securityResult.blocked) {
          return { content: [{ type: 'text', text: `Operation blocked: ${securityResult.error}` }], isError: true };
        }
        const report = await captureNetworkSnapshot({ durationMs, idleMs, maxRequests, includeFailures });
        return { content: [{ type: 'text', text: `Network Snapshot:\n\n${report}` }], isError: false };
      }

      case ToolName.READ_ELECTRON_LOGS: {
        const { logType, lines, follow } = ReadElectronLogsSchema.parse(args);
        const logs = await readElectronLogs(logType, lines);

        if (follow) {
          return {
            content: [
              {
                type: 'text',
                text: `Following logs (${logType}). This is a snapshot of recent logs:\n\n${logs}`,
              },
            ],
            isError: false,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Electron logs (${logType}):\n\n${logs}`,
            },
          ],
          isError: false,
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error(`Tool execution failed: ${name}`, {
      error: errorMessage,
      stack: errorStack,
      args,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}
