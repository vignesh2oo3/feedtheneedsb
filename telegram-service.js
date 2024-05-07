// Function to send an image to Telegram
async function sendImageToTelegram(imageUrl, caption) {
    //const botToken1 = '6788065734:AAHp3qqlHTkj5SddRIicyAxXn6PH8whkgqM'; // Replace with your Telegram Bot Token
    const botToken = '6942256237:AAEAEniFxZ6RX_27HFoPK3DAr94zrjmWRbY'; // Replace with your Telegram Bot Token
    //const chatId = '@feedtheneed3'; // Replace with the chat ID or username of the recipient
    const chatId = '@feedtheneeds23'; // Replace with the chat ID or username of the recipient
  
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: imageUrl,
        caption: caption,
      }),
    });
  
    return await response.json();
  }
  module.exports = {
    sendImageToTelegram,
  };