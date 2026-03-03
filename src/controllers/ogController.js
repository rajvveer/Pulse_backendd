const mongoose = require('mongoose');
const Post = mongoose.model('Post');
const User = mongoose.model('User');
const Reel = mongoose.model('Reel');

// ---------------------------------------------------------------------------
// Helper: Build an HTML page with OG / Twitter meta tags + a deep-link
//         redirect that falls back to the app store.
// ---------------------------------------------------------------------------
function renderOGPage({ title, description, image, url, type = 'article', appDeepLink }) {
    const safeTitle = escapeHtml(title);
    const safeDesc = escapeHtml(description);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${safeTitle}</title>

  <!-- Open Graph -->
  <meta property="og:title"       content="${safeTitle}"/>
  <meta property="og:description" content="${safeDesc}"/>
  <meta property="og:image"       content="${image}"/>
  <meta property="og:url"         content="${url}"/>
  <meta property="og:type"        content="${type}"/>
  <meta property="og:site_name"   content="Pulse"/>

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:title"       content="${safeTitle}"/>
  <meta name="twitter:description" content="${safeDesc}"/>
  <meta name="twitter:image"       content="${image}"/>

  <style>
    body{margin:0;font-family:system-ui,sans-serif;background:#07060B;color:#F0EDF7;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
    h1{font-size:1.8rem;margin-bottom:8px}
    p{color:#9B95A8;max-width:480px;margin-bottom:24px}
    a.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);color:#fff;border-radius:50px;text-decoration:none;font-weight:600;transition:transform .2s}
    a.btn:hover{transform:translateY(-2px)}
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeDesc}</p>
  <a class="btn" href="${appDeepLink || '#'}">Open in Pulse</a>

  <script>
    // Try deep link first, fall back to store / landing page
    (function(){
      var deepLink = "${appDeepLink || ''}";
      if(deepLink){
        var start = Date.now();
        window.location = deepLink;
        setTimeout(function(){
          if(Date.now() - start < 2000){
            // App not installed — redirect to landing or store
            window.location = "https://getpulse.app";
          }
        },1500);
      }
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// GET /share/post/:postId
// ---------------------------------------------------------------------------
exports.sharePost = async (req, res) => {
    try {
        const post = await Post.findById(req.params.postId)
            .populate('author', 'username profile.displayName profile.avatar')
            .lean();

        if (!post) {
            return res.status(404).send('Post not found');
        }

        const authorName = post.author?.profile?.displayName || post.author?.username || 'Someone';
        const description = post.content
            ? post.content.substring(0, 200)
            : `Check out this post by ${authorName} on Pulse`;
        const image = post.media?.[0]?.url || post.author?.profile?.avatar || '';
        const serverUrl = process.env.SERVER_URL || 'https://pulsebackendd-production-1d87.up.railway.app';

        const html = renderOGPage({
            title: `${authorName} on Pulse`,
            description,
            image,
            url: `${serverUrl}/share/post/${post._id}`,
            appDeepLink: `pulse://post/${post._id}`,
        });

        res.set('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error('OG sharePost error:', error);
        res.status(500).send('Internal Server Error');
    }
};

// ---------------------------------------------------------------------------
// GET /share/profile/:username
// ---------------------------------------------------------------------------
exports.shareProfile = async (req, res) => {
    try {
        const user = await User.findOne({
            username: req.params.username.toLowerCase(),
            isActive: true
        }).lean();

        if (!user) {
            return res.status(404).send('Profile not found');
        }

        const displayName = user.profile?.displayName || user.username;
        const bio = user.profile?.bio || `Follow ${displayName} on Pulse`;
        const avatar = user.profile?.avatar || '';
        const serverUrl = process.env.SERVER_URL || 'https://pulsebackendd-production-1d87.up.railway.app';

        const html = renderOGPage({
            title: `${displayName} (@${user.username}) — Pulse`,
            description: bio,
            image: avatar,
            url: `${serverUrl}/share/profile/${user.username}`,
            type: 'profile',
            appDeepLink: `pulse://profile/${user.username}`,
        });

        res.set('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error('OG shareProfile error:', error);
        res.status(500).send('Internal Server Error');
    }
};

// ---------------------------------------------------------------------------
// GET /share/reel/:reelId
// ---------------------------------------------------------------------------
exports.shareReel = async (req, res) => {
    try {
        const reel = await Reel.findById(req.params.reelId)
            .populate('author', 'username profile.displayName profile.avatar')
            .lean();

        if (!reel) {
            return res.status(404).send('Reel not found');
        }

        const authorName = reel.author?.profile?.displayName || reel.author?.username || 'Someone';
        const description = reel.caption
            ? reel.caption.substring(0, 200)
            : `Watch this reel by ${authorName} on Pulse`;
        const thumbnail = reel.thumbnailUrl || reel.author?.profile?.avatar || '';
        const serverUrl = process.env.SERVER_URL || 'https://pulsebackendd-production-1d87.up.railway.app';

        const html = renderOGPage({
            title: `${authorName}'s Reel — Pulse`,
            description,
            image: thumbnail,
            url: `${serverUrl}/share/reel/${reel._id}`,
            type: 'video.other',
            appDeepLink: `pulse://reel/${reel._id}`,
        });

        res.set('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error('OG shareReel error:', error);
        res.status(500).send('Internal Server Error');
    }
};
