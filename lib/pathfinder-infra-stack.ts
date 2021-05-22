import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as efs from "@aws-cdk/aws-efs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import { Duration, RemovalPolicy } from "@aws-cdk/core";

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const UDP = {
      ecsProtocol: ecs.Protocol.UDP,
      elbProtocol: elb.Protocol.UDP,
      ec2Protocol: ec2.Protocol.UDP,
    };

    const TCP = {
      ecsProtocol: ecs.Protocol.TCP,
      elbProtocol: elb.Protocol.TCP,
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

    const loadBalancer = new elb.NetworkLoadBalancer(this, "LoadBalancer", {
      vpc: vpc,
      internetFacing: true,
    });

    const mainCluster = new ecs.Cluster(this, "MainCluster", {
      vpc: vpc,
    });

    // ### SECURITY GROUPS ### //

    const teamspeakSecurityGroup = new ec2.SecurityGroup(this, "TeamspeakSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    const teamspeakPersistenceFsSg = new ec2.SecurityGroup(
      this,
      "TeamspeakPersistenceFsSg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    teamspeakPorts.forEach((forwarding) => {
      teamspeakSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        PathfinderInfraStack.port(
          forwarding.protocol.ec2Protocol,
          forwarding.port
        ),
        "Access for clients of TeamSpeak"
      );
    });

    teamspeakPersistenceFsSg.addIngressRule(
      teamspeakSecurityGroup,
      ec2.Port.allTraffic(),
      "Access for Teamspeak to persistence volume"
    );

    // ### TEAMSPEAK SERVICE ### //

    const teamspeakPersistenceFs = new efs.FileSystem(
      this,
      "TeamspeakPersistenceFs",
      {
        vpc: vpc,
        securityGroup: teamspeakPersistenceFsSg,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    const teamspeakPersistenceVolume: ecs.Volume = {
      name: "TeamspeakPersistence",
      efsVolumeConfiguration: {
        fileSystemId: teamspeakPersistenceFs.fileSystemId,
        rootDirectory: "/",
      },
    };

    const teamspeakTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TeamspeakTask",
      {
        cpu: 512,
        memoryLimitMiB: 2048,
      }
    );

    teamspeakTaskDefinition.addVolume(teamspeakPersistenceVolume);

    const teamspeakTaskContainer = teamspeakTaskDefinition.addContainer(
      "TeamspeakContainer",
      {
        image: ecs.ContainerImage.fromRegistry("teamspeak"),
        memoryLimitMiB: 512,
        environment: {
          TS3SERVER_LICENSE: "accept",
        },
        logging: ecs.AwsLogDriver.awsLogs({
          streamPrefix: "Teamspeak",
        }),
        portMappings: teamspeakPorts.map((element) => {
          return {
            containerPort: element.port,
            hostPort: element.port,
            protocol: element.protocol.ecsProtocol,
          };
        }),
      }
    );

    teamspeakTaskContainer.addMountPoints({
      sourceVolume: teamspeakPersistenceVolume.name,
      containerPath: "/var/ts3server/",
      readOnly: false,
    });

    const teamspeakService = new ecs.FargateService(this, "TeamspeakService", {
      taskDefinition: teamspeakTaskDefinition,
      cluster: mainCluster,
      securityGroups: [teamspeakSecurityGroup],
    });

    teamspeakPorts.forEach((forwarding) => {
      const listener = loadBalancer.addListener(`Listener${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
      });

      listener.addTargets(`AddTargetGroupsId${forwarding.port}`, {
        port: forwarding.port,
        protocol: forwarding.protocol.elbProtocol,
        targets: [
          teamspeakService.loadBalancerTarget({
            containerName: "TeamspeakContainer",
            containerPort: forwarding.port,
            // Not actually used - still fails without it
            protocol: forwarding.protocol.ecsProtocol,
          }),
        ],
        healthCheck: {
          protocol: elb.Protocol.TCP,
          port: "10011",
          healthyThresholdCount: 3,
          unhealthyThresholdCount: 3,
          interval: Duration.seconds(10),
        },
      });
    });
  }

  // ### UTILITY METHODS ### //

  static port(protocol: ec2.Protocol, port: number): ec2.Port {
    return new ec2.Port({
      protocol: protocol,
      fromPort: port,
      toPort: port,
      stringRepresentation: port + "@" + protocol,
    });
  }
}
