const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_p9lr7Vc8J',
            userPoolClientId: '21k9ptj4qh8d0q4bkikcdrebob',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
