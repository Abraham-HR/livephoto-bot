/**
 * Bot de WhatsApp con Baileys
 * Efecto Live Photo / Boomerang
 * 
 * Instalación:
 *   npm install @whiskeysockets/baileys ffmpeg-static fluent-ffmpeg qrcode-terminal
 * 
 * Uso:
 *   node livephoto-bot.js
 */

const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

// ─── Función principal: video → boomerang ────────────────────────────────────
async function convertirBoomerang(inputPath, outputPath, duracionSegundos = 3) {
  return new Promise((resolve, reject) => {
    const tempReverse = inputPath + '_reverse.mp4';

    // Paso 1: Recortar el video a N segundos
    const tempCut = inputPath + '_cut.mp4';

    ffmpeg(inputPath)
      .setDuration(duracionSegundos)
      .output(tempCut)
      .on('end', () => {

        // Paso 2: Crear versión en reversa
        ffmpeg(tempCut)
          .videoFilters('reverse')
          .audioFilters('areverse')
          .output(tempReverse)
          .on('end', () => {

            // Paso 3: Concatenar original + reversa (ida y vuelta)
            const listFile = inputPath + '_list.txt';
            fs.writeFileSync(listFile, `file '${tempCut}'\nfile '${tempReverse}'\n`);

            ffmpeg()
              .input(listFile)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .outputOptions(['-c', 'copy'])
              .output(outputPath)
              .on('end', () => {
                // Limpiar temporales
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

// ─── Bot de WhatsApp ─────────────────────────────────────────────────────────
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  // Mostrar QR para escanear
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escanea este QR con WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('✅ Bot conectado a WhatsApp!');
    }
    if (connection === 'close') {
      console.log('❌ Conexión cerrada, reiniciando...');
      iniciarBot();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ─── Manejar mensajes ──────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const tipo = Object.keys(msg.message)[0];

    // Responder a comandos de texto
    if (tipo === 'conversation' || tipo === 'extendedTextMessage') {
      const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();

      if (texto === '!ayuda' || texto === '!help') {
        await sock.sendMessage(from, {
          text: `🎬 *Bot Live Photo / Boomerang*\n\n` +
                `Envíame un video y lo convertiré en un efecto boomerang (como las Live Photos del iPhone) 🔄\n\n` +
                `📌 *Comandos:*\n` +
                `• Envía cualquier video → lo convierto a boomerang\n` +
                `• !ayuda → muestra este mensaje`
        });
      }
      return;
    }

    // Procesar video
    if (tipo === 'videoMessage') {
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `input_${Date.now()}.mp4`);
      const outputPath = path.join(tmpDir, `boomerang_${Date.now()}.mp4`);

      try {
        // Avisar al usuario
        await sock.sendMessage(from, {
          text: '⏳ Procesando tu video con efecto boomerang... un momento!'
        });

        // Descargar el video
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        fs.writeFileSync(inputPath, buffer);

        // Convertir a boomerang
        await convertirBoomerang(inputPath, outputPath, 3);

        // Enviar el video resultante
        const videoBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(from, {
          video: videoBuffer,
          caption: '🎬 ¡Aquí está tu video con efecto boomerang! 🔄',
          gifPlayback: false,
        });

        console.log(`✅ Boomerang enviado a ${from}`);

      } catch (error) {
        console.error('Error procesando video:', error);
        await sock.sendMessage(from, {
          text: '❌ Hubo un error procesando el video. Asegúrate de que no sea muy largo e intenta de nuevo.'
        });
      } finally {
        // Limpiar archivos temporales
        [inputPath, outputPath].forEach(f => {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        });
      }
    }
  });
}

iniciarBot();
