import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

function sipWsProxy(): Plugin {
  return {
    name: 'sip-ws-proxy',
    configureServer(server) {
      const WS = require('ws');
      const net = require('net');
      const FS_HOST = process.env.FREESWITCH_HOST || '192.168.20.140';
      const FS_WSS_PORT = parseInt(process.env.FREESWITCH_WSS_PORT || '7443');

      const sipWss = new WS.Server({
        noServer: true,
        perMessageDeflate: false,
        handleProtocols: (protocols: Set<string>) => {
          if (protocols.has('sip')) return 'sip';
          return [...protocols][0] || false;
        },
      });

      server.httpServer?.prependListener('upgrade', (req: any, socket: any, head: any) => {
        if ((socket as any).__sipHandled) return;
        const pathname = req.url?.split('?')[0];

        if (pathname === '/ws/sip' || pathname === '/ws/asterisk') {
          (socket as any).__sipHandled = true;
          sipWss.handleUpgrade(req, socket, head, (clientWs: any) => {
            const fsUrl = `wss://${FS_HOST}:${FS_WSS_PORT}`;
            const fsWs = new WS(fsUrl, ['sip'], {
              perMessageDeflate: false,
              rejectUnauthorized: false,
            });
            let ready = false;
            const queue: string[] = [];

            fsWs.on('open', () => {
              ready = true;
              for (const m of queue) fsWs.send(m);
              queue.length = 0;
            });
            clientWs.on('message', (data: any) => {
              const str = data.toString();
              if (ready && fsWs.readyState === WS.OPEN) fsWs.send(str);
              else queue.push(str);
            });
            fsWs.on('message', (data: any) => {
              if (clientWs.readyState === WS.OPEN) clientWs.send(data.toString());
            });
            clientWs.on('close', () => { if (fsWs.readyState <= 1) fsWs.close(1000); });
            fsWs.on('close', () => { if (clientWs.readyState <= 1) clientWs.close(1000); });
            clientWs.on('error', () => fsWs.terminate());
            fsWs.on('error', () => clientWs.terminate());
          });
          return;
        }

        if (pathname === '/ws') {
          (socket as any).__sipHandled = true;
          // General WS: raw TCP pipe to Express backend
          const target = net.connect(3001, '127.0.0.1', () => {
            const reqLine = `GET /ws HTTP/1.1\r\n`;
            const headers: string[] = [];
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              const key = req.rawHeaders[i];
              if (key.toLowerCase() === 'host') headers.push('Host: 127.0.0.1:3001');
              else headers.push(`${key}: ${req.rawHeaders[i + 1]}`);
            }
            target.write(reqLine + headers.join('\r\n') + '\r\n\r\n');
            if (head && head.length) target.write(head);
            socket.pipe(target);
            target.pipe(socket);
          });
          target.on('error', () => socket.destroy());
          socket.on('error', () => target.destroy());
          target.on('close', () => socket.destroy());
          socket.on('close', () => target.destroy());
        }
      });
    },
  };
}

// Check if we're building for Electron or Web
const isElectron = process.env.ELECTRON === 'true';

export default defineConfig(async () => {
  // Enable HTTPS in dev so WebRTC can access media devices
  const plugins = [react(), basicSsl(), sipWsProxy()];
  
  // Only include Electron plugins when building for Electron
  if (isElectron) {
    const electron = (await import('vite-plugin-electron')).default;
    const renderer = (await import('vite-plugin-electron-renderer')).default;
    
    plugins.push(
      electron([
        {
          entry: 'electron/main.ts',
          onstart(options) {
            options.startup();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['pg', 'pg-native', 'pg-pool'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
            },
          },
        },
      ]),
      renderer(),
    );
  }
  
  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@features': path.resolve(__dirname, './src/features'),
        '@services': path.resolve(__dirname, './src/services'),
        '@hooks': path.resolve(__dirname, './src/hooks'),
        '@store': path.resolve(__dirname, './src/store'),
        '@apptypes': path.resolve(__dirname, './src/types'),
        '@utils': path.resolve(__dirname, './src/utils'),
        '@data': path.resolve(__dirname, './src/data'),
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0', // Explicitly bind to all IPv4 interfaces
      https: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        // WebSocket proxying is handled entirely by the sipWsProxy plugin
        // to avoid conflicts between SIP and general WS paths.
        '/ws': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
