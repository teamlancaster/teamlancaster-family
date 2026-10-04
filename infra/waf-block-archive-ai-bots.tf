# NOT APPLIED. Terraform equivalent of infra/waf-block-archive-ai-bots.json (cloudflare provider v5).
# Warning: a zone "http_request_firewall_custom" entrypoint ruleset owns ALL custom rules in that phase;
# import any existing rules before applying. Never touches DNS or the Inkbox email records.
resource "cloudflare_ruleset" "teamlancaster_block_archive_ai" {
  zone_id = "712c61fe6e7e08f8123082b3fa54a2fb"
  name    = "teamlancaster custom rules"
  kind    = "zone"
  phase   = "http_request_firewall_custom"
  rules = [{
    description = "teamlancaster: block archive + AI crawlers (family-only site)"
    action      = "block"
    enabled     = true
    expression  = "(lower(http.user_agent) contains \"ia_archiver\") or (lower(http.user_agent) contains \"archive.org_bot\") or (lower(http.user_agent) contains \"special_archiver\") or (lower(http.user_agent) contains \"heritrix\") or (lower(http.user_agent) contains \"wayback\") or (lower(http.user_agent) contains \"arquivo-web-crawler\") or (lower(http.user_agent) contains \"ccbot\") or (lower(http.user_agent) contains \"gptbot\") or (lower(http.user_agent) contains \"chatgpt-user\") or (lower(http.user_agent) contains \"oai-searchbot\") or (lower(http.user_agent) contains \"claudebot\") or (lower(http.user_agent) contains \"claude-web\") or (lower(http.user_agent) contains \"anthropic-ai\") or (lower(http.user_agent) contains \"perplexitybot\") or (lower(http.user_agent) contains \"perplexity-user\") or (lower(http.user_agent) contains \"bytespider\") or (lower(http.user_agent) contains \"amazonbot\") or (lower(http.user_agent) contains \"applebot-extended\") or (lower(http.user_agent) contains \"meta-externalagent\") or (lower(http.user_agent) contains \"facebookbot\") or (lower(http.user_agent) contains \"cohere-ai\") or (lower(http.user_agent) contains \"diffbot\") or (lower(http.user_agent) contains \"imagesiftbot\") or (lower(http.user_agent) contains \"omgilibot\") or (lower(http.user_agent) contains \"youbot\") or (lower(http.user_agent) contains \"timpibot\") or (lower(http.user_agent) contains \"ai2bot\") or (lower(http.user_agent) contains \"img2dataset\")"
  }]
}

resource "cloudflare_bot_management" "teamlancaster" {
  zone_id            = "712c61fe6e7e08f8123082b3fa54a2fb"
  ai_bots_protection = "block"   # dashboard: Security > Bots > Block AI bots
}
