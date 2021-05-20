import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as rds from "@aws-cdk/aws-rds";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import * as lb from "@aws-cdk/aws-elasticloadbalancingv2";

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const teamspeakDbName = "teamspeak";
    const teamspeakDbUser = "tsuser";

    const teamspeakDbInstanceType = ec2.InstanceType.of(
      ec2.InstanceClass.T2,
      ec2.InstanceSize.MICRO
    );

    const UDP = {
      ecsProtocol: ecs.Protocol.UDP,
      lbProtocol: lb.Protocol.UDP,
      ec2Protocol: ec2.Protocol.UDP,
    };

    const TCP = {
      ecsProtocol: ecs.Protocol.TCP,
      lbProtocol: lb.Protocol.TCP,
      ec2Protocol: ec2.Protocol.TCP,
    };

    const teamspeakPorts = [
      {
        port: 10011,
        protocol: TCP,
      },
      {
        port: 30033,
        protocol: TCP,
      },
      {
        port: 9987,
        protocol: UDP,
      },
    ];

    const vpc = new ec2.Vpc(this, "MainVpc");

    const teamspeakSecurityGroup = new ec2.SecurityGroup(this, "TeamspeakSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    const teamspeakDbSecurityGroup = new ec2.SecurityGroup(
      this,
      "TeamspeakDbSg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    teamspeakDbSecurityGroup.addIngressRule(
      teamspeakSecurityGroup,
      ec2.Port.tcp(3306),
      "Access of DB from Teamspeak"
    );

    const loadBalancer = new lb.NetworkLoadBalancer(this, "LoadBalancer", {
      vpc: vpc,
      internetFacing: true,
    });

    teamspeakPorts.forEach((forwarding) => {
      teamspeakSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        new ec2.Port({
          protocol: forwarding.protocol.ec2Protocol,
          fromPort: forwarding.port,
          toPort: forwarding.port,
          stringRepresentation: `${forwarding.port}@${forwarding.protocol.ec2Protocol}`,
        }),
        "Access for clients of TeamSpeak"
      );
    });

    const teamspeakDbPassword = new secretsmanager.Secret(
      this,
      "TeamspeakDbPassword",
      {
        generateSecretString: {
          includeSpace: false,
          excludePunctuation: true,
        },
      }
    );

    const teamspeakDbCredentials = rds.Credentials.fromPassword(
      teamspeakDbUser,
      teamspeakDbPassword.secretValue
    );

    const teamspeakDbInstance = new rds.DatabaseInstance(this, "TeamspeakDb", {
      engine: rds.DatabaseInstanceEngine.mariaDb({
        version: rds.MariaDbEngineVersion.VER_10_5_8,
      }),
      vpc: vpc,
      databaseName: teamspeakDbName,
      instanceType: teamspeakDbInstanceType,
      credentials: teamspeakDbCredentials,
      securityGroups: [teamspeakDbSecurityGroup],
    });

    const mainCluster = new ecs.Cluster(this, "MainCluster", {
      vpc: vpc,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "Teamspeak", {
      cpu: 512,
      memoryLimitMiB: 2048,
    });

    taskDefinition.addContainer("TeamspeakContainer", {
      image: ecs.ContainerImage.fromRegistry("teamspeak"),
      memoryLimitMiB: 512,
      environment: {
        TS3SERVER_DB_PLUGIN: "ts3db_mariadb",
        TS3SERVER_DB_SQLCREATEPATH: "create_mariadb",
        TS3SERVER_DB_HOST: teamspeakDbInstance.dbInstanceEndpointAddress,
        TS3SERVER_DB_USER: teamspeakDbCredentials.username,
        TS3SERVER_DB_NAME: teamspeakDbName,
        TS3SERVER_DB_WAITUNTILREADY: "30",
        TS3SERVER_LICENSE: "accept",
      },
      secrets: {
        TS3SERVER_DB_PASSWORD:
          ecs.Secret.fromSecretsManager(teamspeakDbPassword),
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "teamspeak-task-logs",
      }),
      portMappings: teamspeakPorts.map((element) => {
        return {
          containerPort: element.port,
          hostPort: element.port,
          protocol: element.protocol.ecsProtocol,
        };
      }),
    });

    const teamspeakService = new ecs.FargateService(this, "TeamspeakService", {
      taskDefinition,
      cluster: mainCluster,
      securityGroups: [teamspeakSecurityGroup],
    });

    teamspeakPorts.forEach((forwarding) => {
      const listener = loadBalancer.addListener(`Listener${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.lbProtocol,
      });

      listener.addTargets(`AddTargetGroupsId${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.lbProtocol,
        targets: [
          teamspeakService.loadBalancerTarget({
            containerName: "TeamspeakContainer",
            containerPort: forwarding.port,
            protocol: forwarding.protocol.ecsProtocol, // Not actually used - still fails without it
          }),
        ],
        healthCheck: {
          protocol: lb.Protocol.TCP,
          port: "10011",
        },
      });
    });
  }
}
