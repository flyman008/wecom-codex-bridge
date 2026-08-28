import { CodexCliAgent } from './agents/codex-cli.js';
import { LocalHttpAgent } from './agents/local-http.js';
import { OpenAiCompatibleAgent } from './agents/openai-compatible.js';
import { loadConfig, loadEnvFileIfPresent } from './config.js';
import { startHealthServer } from './health.js';
import { logger } from './logger.js';
import { RouterAgent } from './router-agent.js';
import { VolcanoSemanticRouter } from './semantic-router.js';
import type { AgentAdapter, AgentName } from './types.js';
import { WeComAgentService } from './wecom-service.js';

const servicePidPath = resolve('.runtime/service.pid');

async function writeServicePid(): Promise<void> {
  await mkdir(resolve('.runtime'), { recursive: true });
  await writeFile(servicePidPath, String(process.pid), 'ascii');
}

async function removeServicePid(): Promise<void> {
  await rm(servicePidPath, { force: true });
}

async function main(): Promise<void> {
  await writeServicePid();
  loadEnvFileIfPresent();
  const config = loadConfig();
  const agentList: AgentAdapter[] = [
    new OpenAiCompatibleAgent(config.llm),
    new CodexCliAgent(config.codex),
    new LocalHttpAgent(config.localAgent),
  ];
  const agents = new Map<AgentName, AgentAdapter>(agentList.map((agent) => [agent.name, agent]));
  const semanticRouter = new VolcanoSemanticRouter(config.llm);
  const routerAgent = await RouterAgent.create(
    config.routerAgent,
    semanticRouter,
    config.wecom.secret,
  );
  const service = new WeComAgentService(config, agents, routerAgent);
  const health = startHealthServer(config.healthPort, service);

  for (const agent of agentList) {
    logger.info('Agent 配置状态', {
      agent: agent.name,
      available: agent.isAvailable(),
      ...(agent.isAvailable() ? {} : { reason: agent.unavailableReason() }),
    });
  }
  logger.info(config.router.mode === 'codex_all' ? 'Codex 对话人设已加载' : '总管 Agent 已加载', {
    name: routerAgent.name,
    routingMode: config.router.mode,
  });

  service.start();
  logger.info('企微 Agent 路由服务已启动', { health: `http://127.0.0.1:${config.healthPort}/health` });

  const shutdown = (signal: string) => {
    logger.info('正在停止服务', { signal });
    service.stop();
    health.close(() => {
      void removeServicePid().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (error) => {
  logger.error('服务启动失败', error);
  await removeServicePid();
  process.exitCode = 1;
});
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
