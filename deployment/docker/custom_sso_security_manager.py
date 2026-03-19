"""
Custom security manager for AWS Cognito OIDC integration with Superset.

Handles:
- Extracting user info from Cognito tokens
- Mapping Cognito groups to Superset roles
- Auto-provisioning users on first login
"""

import logging

from superset.security import SupersetSecurityManager

logger = logging.getLogger(__name__)


class CognitoSecurityManager(SupersetSecurityManager):
    def oauth_user_info(self, provider: str, response: dict = None) -> dict:
        """Extract user info from the Cognito OIDC token.

        Args:
            provider: OAuth provider name (should be "cognito")
            response: OAuth response containing the access token

        Returns:
            Dictionary with user info keys: username, name, email, first_name,
            last_name, role_keys
        """
        if provider != "cognito":
            return super().oauth_user_info(provider, response)

        token = self.appbuilder.sm.oauth_remotes[provider]
        userinfo = token.userinfo()

        username = userinfo.get("cognito:username", userinfo.get("email", ""))
        email = userinfo.get("email", "")
        first_name = userinfo.get("given_name", username)
        last_name = userinfo.get("family_name", "")

        # Cognito groups come as a list in the token
        cognito_groups = userinfo.get("cognito:groups", [])
        if isinstance(cognito_groups, str):
            cognito_groups = [cognito_groups]

        logger.info(
            "Cognito login: user=%s, email=%s, groups=%s",
            username,
            email,
            cognito_groups,
        )

        return {
            "username": username,
            "name": f"{first_name} {last_name}".strip(),
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "role_keys": cognito_groups,
        }
