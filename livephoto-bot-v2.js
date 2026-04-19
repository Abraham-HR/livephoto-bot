/**
 * Bot de WhatsApp con Baileys - Versión Railway FIXED
 * Instalación: npm install @whiskeysockets/baileys @hapi/boom ffmpeg-static fluent-ffmpeg qrcode-terminal
 */

const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

// ─── Función: video → boomerang ──────────────────────────────────────────────
async function convertirBoomerang(inputPath, outputPath, duracionSegundos = 3) {
  return new Promise((resolve, reject) => {
    const tempCut = inputPath + '_cut.mp4';
    const tempReverse = inputPath + '_reverse.mp4';

    ffmpeg(inputPath)
      .setDuration(duracionSegundos)
      .output(tempCut)
      .on('end', () => {
        ffmpeg(tempCut)
          .videoFilters('reverse')
          .output(tempReverse)
          .on('end', () => {
            const listFile = inputPath + '_list.txt';
            fs.writeFileSync(listFile, `file '${tempCut}'\nfile '${tempReverse}'\n`);

            ffmpeg()
              .input(listFile)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .outputOptions(['-c', 'copy'])
              .output(outputPath)
              .on('end', () => {
                [tempCut, tempReverse, listFile].forEach(f => {
                  try { fs.unlinkSync(f); } catch {}
                });
                resolve(outputPath);
              })
              .on('error', reject)
              .run();
          })
          .on('error', reject)
          .run();
      })
      .on('error', reject)
      .run();
  });
}

// ─── Bot ─────────────────────────────────────────────────────────────────────
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['LivePhotoBot', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n======= ESCANEA ESTE QR EN WHATSAPP =======\n');
      qrcode.generate(qr, { small: true });
      console.log('\n===========================================\n');
    }

    if (connection === 'open') {
      console.log('✅ Bot conectado exitosamente a WhatsApp!');
    }

    if (connection === 'close') {
      const codigo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('❌ Conexión cerrada. Código:', codigo);

      if (codigo === DisconnectReason.loggedOut) {
        console.log('🚪 Sesión expirada. Borrando auth y reiniciando...');
        try { fs.rmSync('auth_info', { recursive: true }); } catch {}
      }

      console.log('🔄 Reconectando en 5 segundos...');
      setTimeout(iniciarBot, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ─── Mensajes ───────────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const tipo = Object.keys(msg.message)[0];

    if (tipo === 'conversation' || tipo === 'extendedTextMessage') {
      const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();
      if (texto === '!ayuda' || texto === '!help') {
        await sock.sendMessage(from, {
          text: `🎬 *Bot Live Photo / Boomerang*\n\nEnvíame un video y lo convertiré en efecto boomerang 🔄\n\n*Comandos:*\n• Envía cualquier video → boomerang\n• !ayuda → este mensaje`
        });
      }
      return;
    }

    if (tipo === 'videoMessage') {
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `input_${Date.now()}.mp4`);
      const outputPath = path.join(tmpDir, `boomerang_${Date.now()}.mp4`);

      try {
        await sock.sendMessage(from, { text: '⏳ Procesando tu video con efecto boomerang...' });

        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        fs.writeFileSync(inputPath, buffer);
        await convertirBoomerang(inputPath, outputPath, 3);

        const videoBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(from, {
          video: videoBuffer,
          caption: '🎬 ¡Aquí está tu boomerang! 🔄',
        });

        console.log(`✅ Boomerang enviado a ${from}`);
      } catch (error) {
        console.error('Error:', error);
        await sock.sendMessage(from, { text: '❌ Error procesando el video. Intenta con uno más corto.' });
      } finally {
        [inputPath, outputPath].forEach(f => {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        });
      }
    }
  });
}

iniciarBot();
